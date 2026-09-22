import { describe, expect, it } from "vitest";
import {
    ACTIVE_NOTE_INJECT_LIMIT,
    ACTIVE_NOTE_TOC_HEAD_LINES,
    activeNoteHeadings,
    activeNoteTransmissionFacts,
    buildActiveNoteContext,
    captureActiveNoteSnapshot,
} from "./activeNoteContext";

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

describe("活动笔记上下文档位", () => {
    const NOTE = [
        "# 项目方案",
        "第一段正文",
        "## 目标",
        "目标正文",
        "## 范围",
        "范围正文",
        "### 范围细则",
        "细则正文",
        ...Array.from({ length: 30 }, (_unused, index) => `正文段落 ${index + 1}：这是用来把笔记撑长的填充内容。`),
    ].join("\n");

    it("整篇档原样上行，不标记裁剪", () => {
        const slice = buildActiveNoteContext({ mode: "note", fullText: NOTE });
        expect(slice.content).toBe(NOTE);
        expect(slice.partial).toBe(false);
        expect(slice.omittedChars).toBe(0);
        expect(slice.contextMode).toBe("note");
    });

    it("目录档给标题、开头与去重后的目录，并明确标记裁剪", () => {
        const slice = buildActiveNoteContext({ mode: "toc", fullText: NOTE, tocHeadLines: 2 });
        expect(slice.contextMode).toBe("toc");
        expect(slice.partial).toBe(true);
        expect(slice.content).toContain("【标题】# 项目方案");
        expect(slice.content).toContain("【开头 2 行】");
        expect(slice.content).toContain("# 项目方案\n第一段正文");
        expect(slice.content).not.toContain("第一段正文\n## 目标");
        // 目录把整篇的标题都带上，即使开头几行里没有它们
        expect(slice.content).toContain("### 范围细则");
        expect(slice.content).toContain("【目录】");
        expect(slice.omittedChars).toBeGreaterThan(0);
    });

    it("目录比正文还长时直接给整篇，不做赔本裁剪", () => {
        const shortButHeadingDense = ["# 甲", "## 乙", "## 丙", "## 丁"].join("\n");
        const slice = buildActiveNoteContext({ mode: "toc", fullText: shortButHeadingDense, tocHeadLines: 20 });
        expect(slice.content).toBe(shortButHeadingDense);
        expect(slice.partial).toBe(false);
        expect(slice.omittedChars).toBe(0);
        expect(slice.contextMode).toBe("note");
    });

    it("目录去重，重复标题只出现一次", () => {
        const duplicated = ["# 甲", "正文", "# 甲", "## 乙"].join("\n");
        expect(activeNoteHeadings(duplicated)).toEqual(["# 甲", "## 乙"]);
    });

    it("选区档只发选区文本", () => {
        const slice = buildActiveNoteContext({
            mode: "selection",
            fullText: NOTE,
            selection: { from: { line: 3, ch: 0 }, to: { line: 3, ch: 4 }, text: "目标正文" },
        });
        expect(slice.content).toBe("目标正文");
        expect(slice.partial).toBe(true);
        expect(slice.omittedChars).toBe(NOTE.length - "目标正文".length);
    });

    it("选区窗口档带上前后各 N 行", () => {
        const slice = buildActiveNoteContext({
            mode: "selection_window",
            fullText: NOTE,
            windowLines: 1,
            selection: { from: { line: 3, ch: 0 }, to: { line: 3, ch: 4 }, text: "目标正文" },
        });
        expect(slice.contextMode).toBe("selection_window");
        expect(slice.content.split("\n")).toEqual(["## 目标", "目标正文", "## 范围"]);
    });

    it("没有选区时选区档退回目录档，而不是静默发空内容", () => {
        for (const mode of ["selection", "selection_window"] as const) {
            const slice = buildActiveNoteContext({ mode, fullText: NOTE, tocHeadLines: ACTIVE_NOTE_TOC_HEAD_LINES });
            expect(slice.contextMode).toBe("toc");
            expect(slice.content.length).toBeGreaterThan(0);
            expect(slice.partial).toBe(true);
        }
    });

    it("未获得服务端支持时一律回落整篇，绝不发送服务端会误解的载荷", async () => {
        const editor = {
            getValue: () => NOTE,
            getCursor: (which?: "from" | "to") => (which === "to" ? { line: 3, ch: 4 } : { line: 3, ch: 0 }),
            getSelection: () => "目标正文",
        };
        const gated = await captureActiveNoteSnapshot({
            enabled: true,
            path: "方案.md",
            mode: "edit",
            editor,
            contextMode: "selection",
        });
        // 服务端尚未接受 context_mode：内容与哈希都必须保持整篇形态
        expect(gated.snapshot?.content).toBe(NOTE);

        const full = await captureActiveNoteSnapshot({ enabled: true, path: "方案.md", mode: "edit", editor });
        const allowed = await captureActiveNoteSnapshot({
            enabled: true,
            path: "方案.md",
            mode: "edit",
            editor,
            contextMode: "selection",
            partialContextSupported: true,
        });
        expect(allowed.snapshot?.content).toBe("目标正文");
        // 全文版本号不随后续裁剪改变：回写冲突检测依赖它
        expect(allowed.snapshot?.sha256).toBe(full.snapshot?.sha256);
        expect(allowed.snapshot?.selection?.text).toBe("目标正文");
    });

    it("超过服务端注入上限时明确提示会被再截一刀", () => {
        const over = activeNoteTransmissionFacts({ contextMode: "note", sentChars: ACTIVE_NOTE_INJECT_LIMIT + 1 });
        expect(over.serverTruncated).toBe(true);
        expect(over.injectedChars).toBe(ACTIVE_NOTE_INJECT_LIMIT);
        const under = activeNoteTransmissionFacts({ contextMode: "selection", sentChars: 128, slicePartial: true, sliceOmittedChars: 4000 });
        expect(under.serverTruncated).toBe(false);
        expect(under.injectedChars).toBe(128);
        expect(under.partial).toBe(true);
        expect(under.omittedChars).toBe(4000);
    });
});
