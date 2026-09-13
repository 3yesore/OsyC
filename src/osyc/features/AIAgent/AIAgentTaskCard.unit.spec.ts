import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(
    fileURLToPath(new URL("./AIAgentTaskCard.svelte", import.meta.url)),
    "utf8"
);

describe("AI 任务 artifact 交付状态", () => {
    it("只有本地校验写入成功后才显示已写入笔记库", () => {
        expect(source).toContain('task.deliveryStatus === "delivered"');
        expect(source).toContain("已写入笔记库");
    });

    it("失败任务不把预估积分显示成扣费", () => {
        expect(source).toContain('task.status === "queued" || task.status === "running"');
        expect(source).toContain('task.status === "queued" || task.status === "running"');
        expect(source).not.toContain("模型额度");
        expect(source).not.toContain("-¥");
    });

    it("重复过程事件不会触发 Svelte each_key_duplicate", () => {
        expect(source).toContain("{#each displayProgressEvents as event}");
        expect(source).not.toContain("(event.at + event.phase + event.message)");
    });

    it("完成后的模型正文直接显示在任务卡内", () => {
        expect(source).toContain("task.responseText");
        expect(source).toContain("OC 回复");
    });

    it("流式模型正文在处理中也直接显示，重复阶段事件会去重", () => {
        expect(source).toContain("displayProgressEvents");
        expect(source).toContain("task.responseText");
        expect(source).toContain('task.status === "running"');
    });

    it("模型回复不创建第二个滚动框，长文本随聊天时间线自然展开", () => {
        expect(source).not.toContain("max-height: min(44vh, 520px)");
        expect(source).not.toContain(".ai-task-response-content {\n        max-height:");
        expect(source).not.toContain(".ai-task-response-content {\n        overflow: auto;");
        expect(source).toContain("white-space: pre-wrap;");
    });

    it("待确认任务显示安全的确认操作且不渲染 token", () => {
        expect(source).toContain('task.status === "awaiting_confirmation"');
        expect(source).toContain("确认执行");
        expect(source).toContain("取消操作");
        expect(source).not.toContain("task.confirmation.token");
    });
});
