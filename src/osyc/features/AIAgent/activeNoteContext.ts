export const ACTIVE_NOTE_MAX_BYTES = 1024 * 1024;

export type ActiveNoteMode = "edit" | "live-preview" | "reading";

/**
 * 活动笔记随消息上行的档位。
 *
 * - `note`：整篇正文（默认，也是当前服务端契约唯一接受的形态）。
 * - `toc`：标题 + 开头若干行 + 目录，用于"没选区时也别把整篇塞进去"。
 * - `selection`：只发选区文本。
 * - `selection_window`：选区 + 前后各若干行，给改写/翻译提供足够上下文。
 */
export type ActiveNoteContextMode = "note" | "toc" | "selection" | "selection_window";

export const ACTIVE_NOTE_CONTEXT_MODES: readonly ActiveNoteContextMode[] = [
    "note",
    "toc",
    "selection",
    "selection_window",
];

/** 目录档保留的正文开头行数（目录行不计入）。 */
export const ACTIVE_NOTE_TOC_HEAD_LINES = 20;

/** 选区窗口档在选区前后各保留的行数。 */
export const ACTIVE_NOTE_WINDOW_LINES = 20;

/**
 * 服务端真正注入提示词的活动笔记字符上限。
 *
 * 来源：`backend/app/agent/hermes.py` 的 `ACTIVE_NOTE_CONTENT_LIMIT = 20000`（H2 截断）。
 * 面板用它提示"超长部分不会送达模型"——这是用户看不见、却会直接答错的问题：
 * 一篇 5 万字的笔记，模型只看到前 2 万字，问后半段就会答偏。
 * **服务端改这个值时，必须同步这里。**
 */
export const ACTIVE_NOTE_INJECT_LIMIT = 20000;

export interface ActiveNotePosition {
    line: number;
    ch: number;
}

export interface ActiveNoteSelection {
    from: ActiveNotePosition;
    to: ActiveNotePosition;
    text: string;
}

export interface ActiveNoteSnapshot {
    path: string;
    mode: ActiveNoteMode;
    content: string;
    sha256: string;
    capturedAt: string;
    cursor?: ActiveNotePosition;
    selection?: ActiveNoteSelection;
}

export interface ActiveNoteEditor {
    getValue(): string;
    getCursor(which?: "from" | "to"): ActiveNotePosition;
    getSelection(): string;
}

export interface ActiveNoteCaptureInput {
    enabled: boolean;
    path?: string;
    mode: ActiveNoteMode;
    editor?: ActiveNoteEditor;
    read?: () => Promise<string>;
    /** 期望的上下文档位，默认 `note`。 */
    contextMode?: ActiveNoteContextMode;
    /**
     * 服务端是否已经支持"裁剪版"活动笔记契约。
     *
     * 当前服务端 `api/routes.py` 的 `ActiveNoteRequest` 既用 `sha256(content)` 校验全文一致，
     * 又是 `extra="forbid"`：裁剪后的内容会被 422 拒绝，而 `sha256` 一旦改成"裁片哈希"
     * 又会让模型拿不到可用于 `write_note(expected_sha256)` 的全文版本号。
     * 所以裁剪档必须等 `context_mode`/`note_sha256` 落地服务端后才允许开启；
     * 这里未声明支持时一律回落到 `note`，绝不上行一个服务端会误解的载荷。
     */
    partialContextSupported?: boolean;
}

export interface ActiveNoteCaptureResult {
    snapshot?: ActiveNoteSnapshot;
    error?: "当前笔记超出上下文上限" | "当前设备不支持安全笔记快照" | "无法读取当前笔记";
}

/** 一次裁剪的结果：content 是真正上行/进提示词的正文。 */
export interface ActiveNoteContextSlice {
    content: string;
    /** 服务端只收到笔记的一部分。 */
    partial: boolean;
    /** 被省略的字符数（净差值，用于界面提示"已省略 N 字"）。 */
    omittedChars: number;
    /** 实际生效的档位（请求的档位不可用时可能回落）。 */
    contextMode: ActiveNoteContextMode;
}

function isMarkdownPath(path: string | undefined): path is string {
    return typeof path === "string" && /\.md$/i.test(path);
}

function toHex(buffer: ArrayBuffer): string {
    return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(content: string): Promise<string | undefined> {
    const cryptoApi = typeof window !== "undefined" && window.crypto?.subtle
        ? window.crypto
        : typeof crypto !== "undefined"
          ? crypto
          : undefined;
    if (!cryptoApi?.subtle) return undefined;
    const bytes = new TextEncoder().encode(content);
    return toHex(await cryptoApi.subtle.digest("SHA-256", bytes));
}

/** 第一行非空文本，用作目录档的标题。 */
function firstNonEmptyLine(text: string): string {
    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed) return trimmed;
    }
    return "";
}

/** 所有 Markdown 标题行（去重保序）。 */
export function activeNoteHeadings(text: string): string[] {
    const seen = new Set<string>();
    const headings: string[] = [];
    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!/^#{1,6}\s+\S/.test(trimmed)) continue;
        if (seen.has(trimmed)) continue;
        seen.add(trimmed);
        headings.push(trimmed);
    }
    return headings;
}

/**
 * 按档位把一篇笔记裁成随消息上行的那一份。
 *
 * 纯函数：不依赖 Obsidian，也不做任何读取，便于把"到底发了什么"直接写成单测。
 */
export function buildActiveNoteContext(input: {
    mode: ActiveNoteContextMode;
    fullText: string;
    selection?: ActiveNoteSelection;
    tocHeadLines?: number;
    windowLines?: number;
}): ActiveNoteContextSlice {
    const fullText = input.fullText;
    if (input.mode === "note") {
        return { content: fullText, partial: false, omittedChars: 0, contextMode: "note" };
    }

    const buildToc = (): ActiveNoteContextSlice => {
        const headLimit = Math.max(0, input.tocHeadLines ?? ACTIVE_NOTE_TOC_HEAD_LINES);
        const lines = fullText.split("\n");
        const title = firstNonEmptyLine(fullText);
        const head = lines.slice(0, headLimit).join("\n");
        const headings = activeNoteHeadings(fullText);
        let content = `【标题】${title}\n【开头 ${Math.min(headLimit, lines.length)} 行】\n${head}`;
        if (headings.length > 0) {
            content += `\n【目录】\n${headings.join("\n")}`;
        }
        if (content === fullText) {
            return { content: fullText, partial: false, omittedChars: 0, contextMode: "note" };
        }
        if (content.length >= fullText.length) {
            // 目录反而比正文长（短笔记、标题密集）时直接给整篇：
            // 既不比裁剪版更大，也免得模型拿到一份"比原文还长"的摘要。
            return { content: fullText, partial: false, omittedChars: 0, contextMode: "note" };
        }
        return {
            content,
            partial: true,
            omittedChars: fullText.length - content.length,
            contextMode: "toc",
        };
    };

    if (input.mode === "toc") return buildToc();

    const selection = input.selection;
    const selectedText = selection?.text ?? "";
    if (!selection || !selectedText) {
        // 没有选区时，"只发选区"退化成目录档，而不是静默发空内容。
        return buildToc();
    }

    if (input.mode === "selection") {
        return {
            content: selectedText,
            partial: selectedText !== fullText,
            omittedChars: Math.max(0, fullText.length - selectedText.length),
            contextMode: "selection",
        };
    }

    const windowLines = Math.max(0, input.windowLines ?? ACTIVE_NOTE_WINDOW_LINES);
    const lines = fullText.split("\n");
    const from = Math.max(0, Math.min(selection.from.line, selection.to.line) - windowLines);
    const to = Math.min(lines.length - 1, Math.max(selection.from.line, selection.to.line) + windowLines);
    const windowText = lines.slice(from, to + 1).join("\n");
    return {
        content: windowText,
        partial: windowText !== fullText,
        omittedChars: Math.max(0, fullText.length - windowText.length),
        contextMode: "selection_window",
    };
}

/** 面板要显示的"这条消息到底带了多少上下文"的事实。 */
export interface ActiveNoteTransmissionFacts {
    contextMode: ActiveNoteContextMode;
    sentChars: number;
    injectedChars: number;
    partial: boolean;
    omittedChars: number;
    /** 服务端还会再截一刀，模型看到的比上行的更少。 */
    serverTruncated: boolean;
}

export function activeNoteTransmissionFacts(input: {
    contextMode: ActiveNoteContextMode;
    sentChars: number;
    slicePartial?: boolean;
    sliceOmittedChars?: number;
}): ActiveNoteTransmissionFacts {
    const sentChars = Math.max(0, input.sentChars);
    const injectedChars = Math.min(sentChars, ACTIVE_NOTE_INJECT_LIMIT);
    return {
        contextMode: input.contextMode,
        sentChars,
        injectedChars,
        partial: input.slicePartial ?? input.contextMode !== "note",
        omittedChars: Math.max(0, input.sliceOmittedChars ?? 0),
        serverTruncated: sentChars > ACTIVE_NOTE_INJECT_LIMIT,
    };
}

/**
 * Capture a single Markdown snapshot at send time. This function has no Obsidian
 * dependency so its privacy boundaries can be unit-tested with lightweight fakes.
 */
export async function captureActiveNoteSnapshot(input: ActiveNoteCaptureInput): Promise<ActiveNoteCaptureResult> {
    if (!input.enabled || !isMarkdownPath(input.path)) return {};
    let content: string;
    let cursor: ActiveNotePosition | undefined;
    let selection: ActiveNoteSelection | undefined;
    try {
        if (input.editor && input.mode !== "reading") {
            content = input.editor.getValue();
            cursor = input.editor.getCursor("from");
            const text = input.editor.getSelection();
            if (text) {
                selection = { from: cursor, to: input.editor.getCursor("to"), text };
            }
        } else if (input.mode === "reading" && input.read) {
            content = await input.read();
        } else {
            return {};
        }
    } catch {
        return { error: "无法读取当前笔记" };
    }

    // 全文版本号永远取自整篇正文：它是回写冲突检测（write_note 的 expected_sha256）的依据，
    // 不能随着"这次只发了裁片"而改变。
    const digest = await sha256(content);
    if (!digest) return { error: "当前设备不支持安全笔记快照" };

    const requestedMode = input.contextMode ?? "note";
    const slice = buildActiveNoteContext({
        mode: input.partialContextSupported ? requestedMode : "note",
        fullText: content,
        selection,
    });

    // 大小闸门卡在真正上行的那一份上：整篇档与旧行为完全一致。
    if (new TextEncoder().encode(slice.content).byteLength > ACTIVE_NOTE_MAX_BYTES) {
        return { error: "当前笔记超出上下文上限" };
    }
    return {
        snapshot: {
            path: input.path,
            mode: input.mode,
            content: slice.content,
            sha256: digest,
            capturedAt: new Date().toISOString(),
            ...(cursor ? { cursor } : {}),
            ...(selection ? { selection } : {}),
        },
    };
}
