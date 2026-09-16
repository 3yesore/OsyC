import { describe, expect, it } from "vitest";
import { groupSessionsByRecency, sessionRecencyLabel } from "./sessionList";
import type { AITask } from "./CmdAIAgent";

function task(overrides: Partial<AITask> = {}): AITask {
    return {
        taskId: "task-1",
        message: "整理本周笔记",
        status: "done",
        responseText: "已整理完成",
        createdAt: 100,
        ...overrides,
    };
}

/** A fixed "now" so the bucket boundaries are not clock-dependent. */
const NOW = new Date(2026, 8, 16, 12, 0, 0).getTime();
const DAY = 86_400_000;

describe("会话记录按新近程度分组", () => {
    it("按今天、昨天、前 7 天、更早划分会话", () => {
        expect(sessionRecencyLabel(NOW, NOW)).toBe("今天");
        expect(sessionRecencyLabel(NOW - DAY, NOW)).toBe("昨天");
        expect(sessionRecencyLabel(NOW - 2 * DAY, NOW)).toBe("前 7 天");
        expect(sessionRecencyLabel(NOW - 7 * DAY, NOW)).toBe("前 7 天");
        expect(sessionRecencyLabel(NOW - 8 * DAY, NOW)).toBe("更早");
    });

    it("用本地自然日而非 24 小时窗口判定昨天", () => {
        // 00:30 today is 23.5 hours after 01:00 yesterday, yet it is "今天".
        const earlyToday = new Date(2026, 8, 16, 0, 30, 0).getTime();
        const lateYesterday = new Date(2026, 8, 15, 1, 0, 0).getTime();
        expect(sessionRecencyLabel(earlyToday, NOW)).toBe("今天");
        expect(sessionRecencyLabel(lateYesterday, NOW)).toBe("昨天");
        expect(earlyToday - lateYesterday).toBeLessThan(DAY);
    });

    it("会话按新到旧排列，每个分组只出现一次且自带标题", () => {
        const groups = groupSessionsByRecency(
            [
                task({ taskId: "old", createdAt: NOW - 30 * DAY }),
                task({ taskId: "newest", createdAt: NOW - 60_000 }),
                task({ taskId: "middle", createdAt: NOW - 3 * DAY }),
                task({ taskId: "older", createdAt: NOW - 10 * DAY }),
            ],
            NOW
        );
        expect(groups.map((group) => group.label)).toEqual(["今天", "前 7 天", "更早"]);
        expect(groups[0].tasks.map((entry) => entry.taskId)).toEqual(["newest"]);
        expect(groups[1].tasks.map((entry) => entry.taskId)).toEqual(["middle"]);
        // Newest first inside a bucket too: 10 days ago precedes 30 days ago.
        expect(groups[2].tasks.map((entry) => entry.taskId)).toEqual(["older", "old"]);
    });

    it("不产生空分组，也不因分组丢掉任何会话", () => {
        const tasks = [task({ taskId: "a", createdAt: NOW - 60_000 }), task({ taskId: "b", createdAt: NOW - DAY })];
        const groups = groupSessionsByRecency(tasks, NOW);
        expect(groups.map((group) => group.label)).toEqual(["今天", "昨天"]);
        expect(groups.flatMap((group) => group.tasks)).toHaveLength(tasks.length);
        expect(groups.every((group) => group.tasks.length > 0)).toBe(true);
    });

    it("没有会话时不渲染任何分组", () => {
        expect(groupSessionsByRecency([], NOW)).toEqual([]);
    });
});
