import { describe, expect, it } from "vitest";
import { buildConversationMessages, ensureTaskClientId, mergeModelOutputEvents, mergeProgressEvents, mergeResponseText, shouldFollowTimeline, visibleProgressEvents, type ConversationMessage } from "./conversationModel";
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

describe("Conversation-first 消息读模型", () => {
    it("把一个旧任务映射为稳定的 user/assistant 消息对", () => {
        const messages = buildConversationMessages([task()]);
        expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
        expect(messages[0]).toMatchObject({ id: "task-1:user", text: "整理本周笔记", taskId: "task-1" });
        expect(messages[1]).toMatchObject({ id: "task-1:assistant", text: "已整理完成", taskId: "task-1" });
        expect(messages[0].task).toBe(messages[1].task);
    });

    it("临时任务没有服务端 taskId 时仍产生不重复的稳定消息 ID", () => {
        const first = ensureTaskClientId(task({ taskId: "", createdAt: 200 }));
        const second = ensureTaskClientId(task({ taskId: "", createdAt: 200, message: "另一条消息" }));
        expect(first.clientId).toBeTruthy();
        expect(second.clientId).toBeTruthy();
        expect(first.clientId).not.toBe(second.clientId);
        const messages = buildConversationMessages([first, second]);
        expect(new Set(messages.map((message) => message.id)).size).toBe(messages.length);
    });

    it("旧任务没有 clientId 时使用可复现的兼容 ID，不因刷新改变 key", () => {
        const legacy = task({ taskId: "", clientId: undefined, createdAt: 300 });
        const one = ensureTaskClientId(legacy);
        const two = ensureTaskClientId({ ...legacy });
        expect(one.clientId).toBe(two.clientId);
        expect(buildConversationMessages([one])[1]).toMatchObject({ role: "assistant", text: "已整理完成" });
    });

    it("服务端分配 taskId 后仍保留临时消息 key，避免流式消息重新挂载", () => {
        const pending = task({ taskId: "", clientId: "client-stable" });
        const assigned = { ...pending, taskId: "server-assigned" };
        expect(buildConversationMessages([assigned]).map((message) => message.id)).toEqual([
            "client-stable:user", "client-stable:assistant",
        ]);
    });

    it("assistant 消息保留完整 task 供 Artifact、确认和交付状态继续渲染", () => {
        const message = buildConversationMessages([task({ status: "awaiting_confirmation", responseText: "请确认" })])[1] as ConversationMessage;
        expect(message.task.status).toBe("awaiting_confirmation");
        expect(message.task.responseText).toBe("请确认");
    });

    it("阶段事件按 phase/message/count 幂等合并，并保留先到的事件", () => {
        const first = [
            { phase: "reading", message: "读取笔记", count: 2, at: 100 },
            { phase: "model_output", message: "先分析", at: 110 },
        ];
        const second = [
            { phase: "reading", message: "读取笔记", count: 2, at: 120 },
            { phase: "model_output", message: "先分析", at: 130 },
            { phase: "model_output", message: "再归纳", at: 140 },
        ];
        expect(mergeProgressEvents(first, second)).toEqual([
            first[0], first[1], second[2],
        ]);
    });

    it("正文轮询不会重复拼接，也不会让旧的短响应覆盖已收到的长响应", () => {
        expect(mergeResponseText("我先读取", "我先读取相关笔记")).toBe("我先读取相关笔记");
        expect(mergeResponseText("我先读取相关笔记", "我先读取")).toBe("我先读取相关笔记");
        expect(mergeResponseText("我先读取", "我先读取")).toBe("我先读取");
    });

    it("终态非空正文覆盖不兼容草稿，终态空正文保留已有草稿", () => {
        expect(mergeResponseText("草稿内容", "最终答复", true)).toBe("最终答复");
        expect(mergeResponseText("草稿内容", "", true)).toBe("草稿内容");
    });

    it("只有用户仍贴近时间线底部时才允许自动跟随", () => {
        expect(shouldFollowTimeline({ scrollHeight: 1000, scrollTop: 760, clientHeight: 220 })).toBe(true);
        expect(shouldFollowTimeline({ scrollHeight: 1400, scrollTop: 300, clientHeight: 220 })).toBe(false);
        expect(shouldFollowTimeline({ scrollHeight: 0, scrollTop: 0, clientHeight: 0 })).toBe(true);
    });

    it("终态移除所有瞬时模型与工具过程事件，但运行中保留它们", () => {
        const events = [
            { phase: "analyzing", message: "模型正在分析", at: 100 },
            { phase: "model_output", message: "公开输出", at: 110 },
            { phase: "model_activity", message: "读取笔记", at: 120 },
            { phase: "reading", message: "读取 4 篇笔记", at: 130 },
        ];
        expect(visibleProgressEvents(events, "running").map((event) => event.phase)).toEqual(["analyzing", "model_output", "model_activity", "reading"]);
        expect(visibleProgressEvents(events, "done")).toEqual([]);
    });

    it("兼容旧服务时合并累计与增量模型预览，不只显示最后一条", () => {
        expect(mergeModelOutputEvents([
            { phase: "model_output", message: "模型输出片段：第一段", at: 1 },
            { phase: "model_output", message: "模型输出片段：第一段第二段", at: 2 },
            { phase: "model_output", message: "模型输出片段：第三段", at: 3 },
        ])).toBe("第一段第二段第三段");
    });
});
