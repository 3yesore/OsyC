import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function sourceOf(file: string): string {
    return readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
}

describe("OsyC 用户可见品牌文案", () => {
    it("悬浮球和工作区入口使用 OC 品牌", () => {
        const floating = sourceOf("./AIAgentFloating.ts");
        const pane = sourceOf("./AIAgentPaneView.ts");
        expect(floating).toContain('text: "OC"');
        expect(floating).toContain('打开 oc 对话页');
        expect(pane).toContain('title = "OC"');
        expect(pane).toContain('return "OC"');
    });

    it("任务回复和页面错误提示不再显示 Agent 品牌", () => {
        const task = sourceOf("./AIAgentTaskCard.svelte");
        const pane = sourceOf("./AIAgentPaneView.ts");
        expect(task).toContain('aria-label="OC 回复"');
        expect(task).toContain("<div class=\"ai-task-response-label\">OC 回复</div>");
        expect(pane).toContain("OC 页面暂时无法打开");
    });
});
