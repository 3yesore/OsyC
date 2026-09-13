export const ACTIVE_NOTE_MAX_BYTES = 1024 * 1024;

export type ActiveNoteMode = "edit" | "live-preview" | "reading";

export interface ActiveNotePosition {
    line: number;
    ch: number;
}

export interface ActiveNoteSnapshot {
    path: string;
    mode: ActiveNoteMode;
    content: string;
    sha256: string;
    capturedAt: string;
    cursor?: ActiveNotePosition;
    selection?: {
        from: ActiveNotePosition;
        to: ActiveNotePosition;
        text: string;
    };
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
}

export interface ActiveNoteCaptureResult {
    snapshot?: ActiveNoteSnapshot;
    error?: "当前笔记超出上下文上限" | "当前设备不支持安全笔记快照" | "无法读取当前笔记";
}

function isMarkdownPath(path: string | undefined): path is string {
    return typeof path === "string" && /\.md$/i.test(path);
}

function toHex(buffer: ArrayBuffer): string {
    return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(content: string): Promise<string | undefined> {
    if (!globalThis.crypto?.subtle) return undefined;
    const bytes = new TextEncoder().encode(content);
    return toHex(await globalThis.crypto.subtle.digest("SHA-256", bytes));
}

/**
 * Capture a single Markdown snapshot at send time. This function has no Obsidian
 * dependency so its privacy boundaries can be unit-tested with lightweight fakes.
 */
export async function captureActiveNoteSnapshot(input: ActiveNoteCaptureInput): Promise<ActiveNoteCaptureResult> {
    if (!input.enabled || !isMarkdownPath(input.path)) return {};
    let content: string;
    let cursor: ActiveNotePosition | undefined;
    let selection: ActiveNoteSnapshot["selection"];
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

    if (new TextEncoder().encode(content).byteLength > ACTIVE_NOTE_MAX_BYTES) {
        return { error: "当前笔记超出上下文上限" };
    }
    const digest = await sha256(content);
    if (!digest) return { error: "当前设备不支持安全笔记快照" };
    return {
        snapshot: {
            path: input.path,
            mode: input.mode,
            content,
            sha256: digest,
            capturedAt: new Date().toISOString(),
            ...(cursor ? { cursor } : {}),
            ...(selection ? { selection } : {}),
        },
    };
}
