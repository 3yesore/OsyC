import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(
    fileURLToPath(new URL("./AIAgentAssistantMessage.svelte", import.meta.url)),
    "utf8"
);

describe("OC 实时模型输出", () => {
    it("将 Hermes 的真实活动事件作为 assistant 消息流显示", () => {
        expect(source).toContain("liveActivityEvents");
        expect(source).toContain('event.phase === "model_activity"');
        expect(source).toContain("mergeModelOutputEvents");
        expect(source).toContain("ai-assistant-live-stream");
    });

    it("有真实活动输出时不把固定阶段文案当作主要回复", () => {
        expect(source).toContain("displayProgressEvents");
        expect(source).toContain("liveActivityEvents.length === 0");
    });

    it("将 responseText 作为主流式正文，model_output 只作为无正文时的临时草稿", () => {
        expect(source).toContain("liveOutputText");
        expect(source).toContain("task.responseText");
        expect(source).toContain("mergeModelOutputEvents");
        expect(source).toContain("liveOutputText && !task.responseText");
    });

    it("公开模型正文到达后仍保留真实工具结果摘要，不把活动信息隐藏掉", () => {
        expect(source).toContain("liveToolEvents");
        expect(source).toContain('event.phase === "reading"');
        expect(source).toContain("liveToolEvents.length > 0");
    });

    it("旧服务遗留的固定整理步骤不能通过 progress 回退重新显示", () => {
        expect(source).toContain("FIXED_PROGRESS_MESSAGES");
        expect(source).toContain("!FIXED_PROGRESS_MESSAGES.has(task.progress)");
    });

    it("assistant 头部只保留一个 OC 标志，完成后不渲染瞬时生命周期文案", () => {
        expect(source).not.toContain('class="ai-assistant-name"');
        expect(source).toContain('task.status === "queued" || task.status === "running"');
    });

    it("回复正文复用 Obsidian MarkdownRenderer，并在流式更新时清理旧渲染实例", () => {
        expect(source).toContain('import { App, Component, MarkdownRenderer } from "@/deps.ts"');
        expect(source).toContain("MarkdownRenderer.render");
        expect(source).toContain("renderedContentEl");
        expect(source).toContain("component.unload()");
        expect(source).not.toMatch(/\.ai-assistant-content\s*\{[^}]*white-space/);
    });
});
