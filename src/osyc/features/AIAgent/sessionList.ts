import type { AITask } from "./CmdAIAgent";

/**
 * Recency grouping read model for the session list.
 *
 * The pane renders conversation history the way ChatGPT does: newest first,
 * with a date heading in front of, and only in front of, each bucket that
 * actually has entries. Keeping this here rather than in the Svelte component
 * makes the bucket boundaries testable without a DOM.
 */
export interface SessionGroup {
    label: string;
    tasks: AITask[];
}

const DAY_MS = 86_400_000;

/**
 * Calendar-day boundary in local time. A 00:30 message must not be grouped as
 * "昨天" just because fewer than 24 hours have elapsed.
 */
function startOfLocalDay(timestamp: number): number {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

/**
 * Recency bucket for a single task. `Math.round` keeps the boundary stable
 * across daylight-saving days, whose local day is 23 or 25 hours long.
 */
export function sessionRecencyLabel(createdAt: number, now = Date.now()): string {
    const elapsedDays = Math.round((startOfLocalDay(now) - startOfLocalDay(createdAt)) / DAY_MS);
    if (elapsedDays <= 0) return "今天";
    if (elapsedDays === 1) return "昨天";
    if (elapsedDays <= 7) return "前 7 天";
    return "更早";
}

/**
 * Group tasks newest-first, skipping empty buckets.
 *
 * Sorting before grouping is what lets the loop coalesce adjacent tasks into
 * one heading; the buckets are therefore ordered oldest-last by construction.
 */
export function groupSessionsByRecency(tasks: AITask[], now = Date.now()): SessionGroup[] {
    const ordered = [...tasks].sort((a, b) => b.createdAt - a.createdAt);
    const groups: SessionGroup[] = [];
    for (const task of ordered) {
        const label = sessionRecencyLabel(task.createdAt, now);
        const current = groups[groups.length - 1];
        if (current && current.label === label) current.tasks.push(task);
        else groups.push({ label, tasks: [task] });
    }
    return groups;
}
