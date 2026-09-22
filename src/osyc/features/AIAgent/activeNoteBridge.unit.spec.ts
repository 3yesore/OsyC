import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./activeNoteBridge.ts", import.meta.url)), "utf8");

describe("活动笔记桥接层的只读约定", () => {
    it("从当前活动视图取笔记，而不是扫描整个库", () => {
        expect(source).toContain("getActiveViewOfType(MarkdownView)");
        expect(source).not.toContain("getMarkdownFiles");
        expect(source).not.toContain("vault.getFiles");
    });

    it("绝不写入：没有 setValue、没有 vault 修改或新建", () => {
        expect(source).not.toContain("setValue");
        expect(source).not.toContain("vault.modify");
        expect(source).not.toContain("vault.create");
        expect(source).not.toContain("vault.delete");
        expect(source).not.toContain("editor.replaceRange");
    });

    it("阅读态走 vault 的已保存内容，不直接读文件系统", () => {
        expect(source).toContain("app.vault.cachedRead(file)");
        expect(source).not.toContain("adapter.read");
        expect(source).not.toContain("node:fs");
    });

    it("不依赖 globalThis（Obsidian 移动端窗口约定）", () => {
        expect(source).not.toContain("globalThis");
    });
});
