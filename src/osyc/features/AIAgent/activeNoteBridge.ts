import { MarkdownView, type App } from "@/deps.ts";
import {
    captureActiveNoteSnapshot,
    type ActiveNoteCaptureResult,
    type ActiveNoteContextMode,
    type ActiveNoteMode,
} from "./activeNoteContext";

export interface ActiveNoteBridgeOptions {
    /** 关闭时不读取任何正文，直接返回空快照。 */
    enabled?: boolean;
    /** 期望的上下文档位；服务端未支持裁剪契约时会自动回落整篇。 */
    contextMode?: ActiveNoteContextMode;
    /** 服务端是否已支持裁剪版活动笔记契约（见 activeNoteContext 的说明）。 */
    partialContextSupported?: boolean;
}

/**
 * 判断当前视图处于哪种笔记模式。
 *
 * Obsidian 的 `getMode()` 只分 source / preview；source 模式下 `state.source === true`
 * 才是纯源码（旧编辑器），否则是实时预览。两者正文与哈希完全一致，区分它只是为了
 * 让服务端提示词里的"模式"如实描述用户此刻看到的样子。
 */
function resolveActiveNoteMode(view: MarkdownView): ActiveNoteMode {
    if (view.getMode() === "preview") return "reading";
    const source = (view.getState() as { source?: boolean } | undefined)?.source;
    return source === true ? "edit" : "live-preview";
}

/**
 * 取一份"用户此刻正在看的笔记"快照，用于随消息一并上行。
 *
 * 只读：本模块只从正在编辑的视图或已保存的 vault 内容里取值，绝不写入、绝不新建文件。
 * 每次调用都重新读取，保证快照的 sha256 与用户按下发送那一刻看到的内容一致——
 * 这个哈希随后被回写冲突检测（write_note 的 expected_sha256）当作版本号使用。
 */
export async function captureActiveNoteFromApp(
    app: App,
    options: ActiveNoteBridgeOptions = {}
): Promise<ActiveNoteCaptureResult> {
    const view = app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file;
    if (!view || !file) return {};

    const enabled = options.enabled ?? true;
    const mode = resolveActiveNoteMode(view);
    if (mode === "reading") {
        // 阅读态没有可信光标，不伪造；正文一律走 vault 的已保存内容。
        return captureActiveNoteSnapshot({
            enabled,
            path: file.path,
            mode,
            read: () => app.vault.cachedRead(file),
            contextMode: options.contextMode,
            partialContextSupported: options.partialContextSupported,
        });
    }

    const editor = view.editor;
    if (!editor) return {};
    return captureActiveNoteSnapshot({
        enabled,
        path: file.path,
        mode,
        editor: {
            getValue: () => editor.getValue(),
            getCursor: (which?: "from" | "to") => (which ? editor.getCursor(which) : editor.getCursor()),
            getSelection: () => editor.getSelection(),
        },
        contextMode: options.contextMode,
        partialContextSupported: options.partialContextSupported,
    });
}
