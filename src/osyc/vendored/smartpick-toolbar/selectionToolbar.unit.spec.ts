import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./selectionToolbar.ts", import.meta.url)), "utf8");

describe("选择浮条机制层（改写自 SmartPick）的约定", () => {
    it("容器挂在视图内容区里，而不是 document.body", () => {
        expect(source).toContain("contentEl.createDiv");
        expect(source).not.toContain("document.body");
        expect(source).not.toContain(".appendeChild");
    });

    it("用 Obsidian 的 DOM 帮助函数，不自己造节点", () => {
        expect(source).not.toContain("document.createElement");
        expect(source).toContain("createDiv");
    });

    it("不依赖 globalThis，也不引入框架/CodeMirror 包", () => {
        expect(source).not.toContain("globalThis");
        expect(source).not.toContain("@codemirror/");
        expect(source).not.toContain("react");
    });

    it("保留移动端三条守卫：触摸位移、关闭后静默期、交互后静默期", () => {
        expect(source).toContain("TOUCH_MOVE_TOLERANCE_PX = 8");
        expect(source).toContain("OUTSIDE_DISMISS_GUARD_MS");
        expect(source).toContain("TOOLBAR_INTERACTION_GUARD_MS = 500");
        expect(source).toContain("ignoreSelectionChangeUntil");
        expect(source).toContain("restoreCurrentSelection");
    });

    it("移动端定位不跟选区，改用 visualViewport 与视图头部", () => {
        expect(source).toContain("visualViewport");
        expect(source).toContain(".view-header");
        expect(source).toContain("position: Platform.isMobile ? \"fixed\" : \"absolute\"");
    });

    it("尺寸用实测值钳制，不写死工具栏宽高", () => {
        // 只断言定位代码用的是实测尺寸；注释里出现"上游写死 350x60"是允许的。
        expect(source).toContain("const width = element?.getBoundingClientRect().width ?? 0");
        expect(source).toContain("const height = element?.getBoundingClientRect().height ?? 0");
    });

    it("随代码保留上游 MIT 许可证，并有出处说明", () => {
        const dir = fileURLToPath(new URL(".", import.meta.url));
        expect(existsSync(dir + "LICENSE")).toBe(true);
        expect(existsSync(dir + "PROVENANCE.md")).toBe(true);
        const license = readFileSync(dir + "LICENSE", "utf8");
        expect(license).toContain("MIT License");
        expect(license).toContain("Copyright (c) 2026 BCS");
        const provenance = readFileSync(dir + "PROVENANCE.md", "utf8");
        expect(provenance).toContain("57022feaabf9aef32bf4ec8ca585de08f5c32bbb");
    });
});
