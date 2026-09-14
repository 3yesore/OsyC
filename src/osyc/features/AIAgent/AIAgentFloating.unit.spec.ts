import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./AIAgentFloating.ts", import.meta.url)), "utf8");

describe("OsyC 浮动入口的 Obsidian DOM 约定", () => {
    it("通过 Obsidian createEl 创建浮动球节点", () => {
        expect(source).toContain(".createDiv(");
        expect(source).toContain('.createEl("button"');
        expect(source).not.toContain("document.createElement");
    });

    it("使用当前窗口保存跨热重载清理句柄", () => {
        expect(source).toContain("window as OsyCWindow");
        expect(source).not.toContain("globalThis");
    });
});
