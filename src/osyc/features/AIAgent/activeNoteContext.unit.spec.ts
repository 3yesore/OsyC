import { describe, expect, it } from "vitest";
import { captureActiveNoteSnapshot } from "./activeNoteContext";

describe("当前 Markdown 笔记快照", () => {
    it("编辑态读取未保存的内存文本、光标与选区", async () => {
        const result = await captureActiveNoteSnapshot({
            enabled: true,
            path: "项目/方案.md",
            mode: "edit",
            editor: {
                getValue: () => "# 未保存标题\n正文",
                getCursor: (which?: "from" | "to") => (which === "to" ? { line: 1, ch: 2 } : { line: 1, ch: 0 }),
                getSelection: () => "正文",
            },
        });
        expect(result.error).toBeUndefined();
        expect(result.snapshot).toMatchObject({
            path: "项目/方案.md",
            mode: "edit",
            content: "# 未保存标题\n正文",
            cursor: { line: 1, ch: 0 },
            selection: { from: { line: 1, ch: 0 }, to: { line: 1, ch: 2 }, text: "正文" },
        });
        expect(result.snapshot?.sha256).toMatch(/^[a-f0-9]{64}$/);
    });

    it("阅读态只读取已保存 Markdown，且不伪造光标", async () => {
        const result = await captureActiveNoteSnapshot({
            enabled: true,
            path: "归档/笔记.md",
            mode: "reading",
            read: async () => "# 已保存内容",
        });
        expect(result.snapshot).toMatchObject({ path: "归档/笔记.md", mode: "reading", content: "# 已保存内容" });
        expect(result.snapshot?.cursor).toBeUndefined();
        expect(result.snapshot?.selection).toBeUndefined();
    });

    it("关闭开关或不是 Markdown 时绝不读取、不上传", async () => {
        let readCount = 0;
        const disabled = await captureActiveNoteSnapshot({
            enabled: false,
            path: "笔记.md",
            mode: "reading",
            read: async () => { readCount++; return "不应读取"; },
        });
        const nonMarkdown = await captureActiveNoteSnapshot({
            enabled: true,
            path: "图片.png",
            mode: "reading",
            read: async () => { readCount++; return "不应读取"; },
        });
        expect(disabled.snapshot).toBeUndefined();
        expect(nonMarkdown.snapshot).toBeUndefined();
        expect(readCount).toBe(0);
    });

    it("超过 1 MiB 时不截断也不创建快照", async () => {
        const result = await captureActiveNoteSnapshot({
            enabled: true,
            path: "超长.md",
            mode: "reading",
            read: async () => "a".repeat(1024 * 1024 + 1),
        });
        expect(result.snapshot).toBeUndefined();
        expect(result.error).toBe("当前笔记超出上下文上限");
    });
});
