import type { AITask, AITaskStatus } from "./CmdAIAgent";

export interface AgentProgressEvent {
    phase: string;
    message: string;
    count?: number;
    at: number;
}

export type ConversationMessageRole = "user" | "assistant";

/**
 * UI-only message read model. The task remains the source of truth so legacy
 * polling, artifact delivery and confirmation callbacks keep their contract.
 */
export interface ConversationMessage {
    id: string;
    conversationId: string;
    role: ConversationMessageRole;
    text: string;
    taskId: string;
    task: AITask;
}

let clientSequence = 0;

/** Create an ID for a task before the server has assigned task_id. */
export function createTaskClientId(now = Date.now()): string {
    clientSequence = (clientSequence + 1) % 1_000_000;
    return `client-${now.toString(36)}-${clientSequence.toString(36)}`;
}

function stableLegacyId(task: AITask): string {
    // FNV-1a keeps persisted pre-clientId tasks deterministic without storing
    // note content in the ID or depending on a random source after reload.
    const seed = `${task.createdAt}:${task.message}`;
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index++) {
        hash ^= seed.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `legacy-${(hash >>> 0).toString(16)}`;
}

/** Return a task with a stable client-side identity, preserving all fields. */
export function ensureTaskClientId(task: AITask): AITask {
    if (task.clientId?.trim()) return task;
    // A persisted/server task already has a stable identity; do not rewrite
    // its key merely because older releases did not store clientId.
    if (task.taskId.trim()) return task;
    return { ...task, clientId: stableLegacyId(task) };
}

function taskIdentity(task: AITask): string {
    const normalized = ensureTaskClientId(task);
    // Keep the client identity after the server assigns task_id; otherwise the
    // keyed Svelte message would be destroyed and recreated mid-stream.
    return normalized.clientId || normalized.taskId.trim();
}

/** Map legacy tasks into the conversation-first user/assistant timeline. */
export function buildConversationMessages(tasks: AITask[]): ConversationMessage[] {
    return tasks.flatMap((originalTask) => {
        const task = ensureTaskClientId(originalTask);
        const identity = taskIdentity(task);
        const conversationId = `conversation:${identity}`;
        return [
            {
                id: `${identity}:user`,
                conversationId,
                role: "user" as const,
                text: task.message,
                taskId: task.taskId || task.clientId!,
                task,
            },
            {
                id: `${identity}:assistant`,
                conversationId,
                role: "assistant" as const,
                text: task.responseText ?? "",
                taskId: task.taskId || task.clientId!,
                task,
            },
        ];
    });
}

function progressEventKey(event: AgentProgressEvent): string {
    return `${event.phase}\u0000${event.message}\u0000${event.count ?? ""}`;
}

/** Merge cumulative/partial polling responses without duplicating events. */
export function mergeProgressEvents(
    existing: AgentProgressEvent[] | undefined,
    incoming: AgentProgressEvent[] | undefined,
): AgentProgressEvent[] {
    const merged: AgentProgressEvent[] = [];
    const seen = new Set<string>();
    for (const event of [...(existing ?? []), ...(incoming ?? [])]) {
        if (!event || typeof event.phase !== "string" || typeof event.message !== "string") continue;
        const normalized: AgentProgressEvent = {
            phase: event.phase,
            message: event.message,
            ...(typeof event.count === "number" && Number.isFinite(event.count) ? { count: event.count } : {}),
            at: typeof event.at === "number" && Number.isFinite(event.at) ? event.at : Date.now(),
        };
        const key = progressEventKey(normalized);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(normalized);
    }
    return merged;
}

/**
 * Merge response_text from polling. Hermes sends a cumulative visible draft,
 * but older gateways can return a stale/empty frame during reconnects.
 */
export function mergeResponseText(existing: string | undefined, incoming: string | undefined, terminal = false): string | undefined {
    const current = typeof existing === "string" ? existing : "";
    const next = typeof incoming === "string" ? incoming : "";
    if (!next.trim()) return current || undefined;
    if (!current || terminal) return next;
    if (next.startsWith(current)) return next;
    if (current.startsWith(next)) return current;
    // Incompatible non-terminal responses are treated as a newer authoritative
    // draft, never concatenated, which prevents duplicated model output.
    return next;
}

/** Keep auto-follow local to the timeline and leave an intentionally scrolled-up user alone. */
export function shouldFollowTimeline(
    metrics: { scrollHeight: number; scrollTop: number; clientHeight: number },
    threshold = 96,
): boolean {
    const remaining = metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight;
    return !Number.isFinite(remaining) || remaining <= Math.max(0, threshold);
}

const TERMINAL_TASK_STATUSES = new Set<AITaskStatus>([
    "done", "failed", "conflict", "interrupted", "failed_zero_cost", "delivery_failed", "cancelled",
]);

export const EPHEMERAL_PROGRESS_MESSAGES = new Set(["analyzing", "model_output", "model_activity", "reading"]);

/** Runtime model/tool events are useful while a task is active only. */
export function isEphemeralProgressEvent(event: AgentProgressEvent): boolean {
    return EPHEMERAL_PROGRESS_MESSAGES.has(event.phase);
}

/** Hide all transient model/tool markers once a task has a terminal result. */
export function visibleProgressEvents(events: AgentProgressEvent[] | undefined, status: AITaskStatus): AgentProgressEvent[] {
    return (events ?? []).filter((event) => !(TERMINAL_TASK_STATUSES.has(status) && isEphemeralProgressEvent(event)));
}

/** Merge visible preview events for old gateways that do not stream response_text. */
export function mergeModelOutputEvents(events: AgentProgressEvent[] | undefined): string {
    let output = "";
    for (const event of events ?? []) {
        if (event.phase !== "model_output") continue;
        const next = event.message.replace(/^模型输出片段：/, "").trim();
        if (!next) continue;
        if (!output) {
            output = next;
        } else if (next.startsWith(output)) {
            // Cumulative snapshot.
            output = next;
        } else if (output.startsWith(next) || output.includes(next)) {
            // Duplicate/stale snapshot.
            continue;
        } else {
            // Delta or a snapshot whose common prefix is not repeated.
            let overlap = 0;
            const max = Math.min(output.length, next.length);
            for (let size = max; size > 0; size--) {
                if (output.slice(-size) === next.slice(0, size)) {
                    overlap = size;
                    break;
                }
            }
            output += next.slice(overlap);
        }
    }
    return output;
}
