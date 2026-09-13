import type { AIAgentState, AITask, AITaskStatus } from "@/osyc/features/AIAgent/CmdAIAgent";
import { parseAppearance, type AppearanceSettings } from "@/osyc/features/AIAgent/appearance";
import { parseFontResources, type FontResource } from "@/osyc/theme/fontResources";

export const PERSISTED_VERSION = 1;

export interface AIAgentPersisted {
    version: number;
    apiBase?: string;
    token?: string;
    deviceId?: string;
    state?: Partial<AIAgentState>;
    tasks?: AITask[];
    tripleTap?: boolean;
    showBall?: boolean;
    includeActiveNoteContext?: boolean;
    /** Normalized 0..1 floating-ball coordinates. */
    floatingPosition?: { x: number; y: number };
    appearance?: AppearanceSettings;
    fontResources?: FontResource[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTaskStatus(value: unknown): value is AITaskStatus {
    return value === "queued" || value === "running" || value === "done" || value === "failed";
}

function isTask(value: unknown): value is AITask {
    if (!isRecord(value)) return false;
    return (
        typeof value.taskId === "string" &&
        typeof value.message === "string" &&
        isTaskStatus(value.status) &&
        typeof value.createdAt === "number" &&
        Number.isFinite(value.createdAt)
    );
}

/** Parse persisted plugin state defensively. Invalid fields are omitted. */
export function parseAIAgentPersisted(raw: string): AIAgentPersisted {
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        return { version: PERSISTED_VERSION };
    }
    if (!isRecord(value)) return { version: PERSISTED_VERSION };

    const parsed: AIAgentPersisted = { version: PERSISTED_VERSION };
    parsed.appearance = parseAppearance(value.appearance);
    parsed.fontResources = parseFontResources(value.fontResources);
    if (typeof value.apiBase === "string") parsed.apiBase = value.apiBase;
    if (typeof value.token === "string") parsed.token = value.token;
    if (typeof value.deviceId === "string") parsed.deviceId = value.deviceId;
    if (isRecord(value.state)) parsed.state = value.state;
    if (Array.isArray(value.tasks)) parsed.tasks = value.tasks.filter(isTask);
    if (typeof value.tripleTap === "boolean") parsed.tripleTap = value.tripleTap;
    if (typeof value.showBall === "boolean") parsed.showBall = value.showBall;
    if (typeof value.includeActiveNoteContext === "boolean") {
        parsed.includeActiveNoteContext = value.includeActiveNoteContext;
    }
    if (
        isRecord(value.floatingPosition) &&
        typeof value.floatingPosition.x === "number" && Number.isFinite(value.floatingPosition.x) &&
        typeof value.floatingPosition.y === "number" && Number.isFinite(value.floatingPosition.y) &&
        value.floatingPosition.x >= 0 && value.floatingPosition.x <= 1 &&
        value.floatingPosition.y >= 0 && value.floatingPosition.y <= 1
    ) {
        parsed.floatingPosition = { x: value.floatingPosition.x, y: value.floatingPosition.y };
    }
    return parsed;
}
