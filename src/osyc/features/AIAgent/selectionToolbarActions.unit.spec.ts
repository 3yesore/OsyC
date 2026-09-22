import { describe, expect, it } from "vitest";
import {
    SELECTION_ACTION_PROMPTS,
    SELECTION_MESSAGE_MAX_CHARS,
    SELECTION_TOOLBAR_ACTIONS,
    buildSelectionMessage,
} from "./selectionToolbarActions";

describe("选中内容的动作与提示词", () => {
    it("每个动作都有对应的提示词，且 id 不重复", () => {
        const ids = SELECTION_TOOLBAR_ACTIONS.map((action) => action.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) {
            expect(SELECTION_ACTION_PROMPTS[id]).toBeTruthy();
        }
    });

    it("图标名是 Obsidian 风格的小写连字符名", () => {
        for (const action of SELECTION_TOOLBAR_ACTIONS) {
            expect(action.icon).toMatch(/^[a-z0-9-]+$/);
        }
    });

    it("快照已附上时只发提示词，不重复粘贴选区", () => {
        const message = buildSelectionMessage("explain", "被选中的一段话", true);
        expect(message).toBe(SELECTION_ACTION_PROMPTS.explain);
        expect(message).not.toContain("被选中的一段话");
    });

    it("快照缺失时把选中文本截断后写进消息兜底", () => {
        const long = "字".repeat(5000);
        const message = buildSelectionMessage("rewrite", long, false);
        expect(message).toContain("【选中内容】");
        expect(message.length).toBeLessThanOrEqual(SELECTION_MESSAGE_MAX_CHARS);
        expect(message.endsWith("…")).toBe(true);
    });

    it("短选区在快照缺失时原样带上", () => {
        const message = buildSelectionMessage("todos", "把这段拆成待办", false);
        expect(message).toContain("把这段拆成待办");
    });

    it("未知动作返回空串（上层据此不发请求）", () => {
        expect(buildSelectionMessage("no-such-action", "文本", false)).toBe("");
        expect(buildSelectionMessage("explain", "   ", true)).not.toBe("");
    });
});
