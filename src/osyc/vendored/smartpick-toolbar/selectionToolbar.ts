import { MarkdownView, Platform, type App, type Editor } from "@/deps.ts";
import { mount, unmount } from "svelte";
import SelectionToolbarComponent from "./SelectionToolbar.svelte";

/**
 * 选择工具栏的机制层。
 *
 * 改写自 `BCS1037/SmartPick` @ `57022fe`（MIT）的 `src/toolbar/Toolbar.ts` 与 `ToolbarUI.ts`：
 * 保留它那套经过移动端打磨的事件分流、触摸位移判定与定位数学，去掉上游的业务动作与设置项。
 * 见同目录 `PROVENANCE.md`。
 */

export interface SelectionToolbarAction {
    id: string;
    label: string;
    /** Obsidian 内置图标名（必须存在于图标表中）。 */
    icon: string;
}

export interface SelectionToolbarSelection {
    text: string;
    /** 当前笔记路径（可能为空：未保存的临时视图）。 */
    path: string | null;
    editor: Editor;
}

export interface SelectionToolbarOptions {
    app: App;
    actions: readonly SelectionToolbarAction[];
    /** 点击动作时回调：面板负责把它变成一次提问。 */
    onAction: (actionId: string, selection: SelectionToolbarSelection) => void;
    /** 多窗口/测试用；默认取编辑器所在窗口。 */
    window?: Window;
    document?: Document;
}

/** 选区稳定后再弹，避免拖动过程中闪烁。 */
const SELECTION_TOOLBAR_DELAY_MS = 200;
/**
 * 主动关闭后的静默期：同一次点击随后还会派发 mouseup/touchend，
 * 不屏蔽就会"刚关掉又立刻打开"。
 */
const OUTSIDE_DISMISS_GUARD_MS = SELECTION_TOOLBAR_DELAY_MS + 50;
/**
 * iOS 上点浮动按钮会触发一次 selectionchange。忽略窗口设得比关闭守卫长，
 * 否则"更多"菜单刚展开就被重新渲染收起。
 */
const TOOLBAR_INTERACTION_GUARD_MS = 500;
/** 手指位移超过这个距离视为滚动，不弹窗。 */
const TOUCH_MOVE_TOLERANCE_PX = 8;
const TOOLBAR_CONTAINER_CLASS = "osyc-selection-toolbar-container";
const TOOLBAR_MARGIN_PX = 8;
/** 选区远离视口时（多行选区最后一行已滚出）不弹窗。 */
const MIN_VERTICAL_ROOM_PX = 10;
/** 选区很宽或多行时，桌面端以选区中心为锚点。 */
const CENTER_ALIGNMENT_WIDTH_RATIO = 0.6;
const RIGHT_ALIGNMENT_CENTER_RATIO = 0.6;

interface SelectionCoords {
    left: number;
    right: number;
    top: number;
    bottom: number;
    isMultiLine: boolean;
    textLeft: number;
    textWidth: number;
}

interface SavedSelectionRange {
    anchor: { line: number; ch: number };
    head: { line: number; ch: number };
}

/** Obsidian 的 `editor.cm` 是未公开的内部编辑器实例，只取我们要用的那一个方法。 */
interface EditorWithCodeMirror {
    cm?: {
        coordsAtPos(pos: number, bias?: number): { left: number; right: number; top: number; bottom: number } | null;
    };
}

/**
 * 测试环境（node/vitest）里没有 Obsidian 的 DOM 全局量。用 typeof 探测而不是直接引用：
 * 拿不到就把工具栏置为不可用，绝不在构造期抛错——它挂在插件启动路径上。
 */
function resolveGlobalDocument(): Document | null {
    return typeof activeDocument === "undefined" ? null : activeDocument;
}

function resolveGlobalWindow(doc: Document | null): Window | null {
    if (doc?.defaultView) return doc.defaultView;
    return typeof window === "undefined" ? null : window;
}

export class SelectionToolbar {
    private readonly app: App;
    private readonly actions: readonly SelectionToolbarAction[];
    private readonly onAction: SelectionToolbarOptions["onAction"];
    private containerEl: HTMLElement | null = null;
    private component: ReturnType<typeof mount> | null = null;
    private debounceTimer: number | null = null;
    private watchedEditorEl: HTMLElement | null = null;
    private outsidePointerDocument: Document | null = null;
    private currentEditor: Editor | null = null;
    private currentView: MarkdownView | null = null;
    private currentSelectionText = "";
    private currentSelectionRange: SavedSelectionRange | null = null;
    private isVisible = false;
    private touchStartX = 0;
    private touchStartY = 0;
    private touchMoved = false;
    private ignoreSelectionChangeUntil = 0;

    constructor(options: SelectionToolbarOptions) {
        this.app = options.app;
        this.actions = options.actions;
        this.onAction = options.onAction;
        this.doc = options.document ?? resolveGlobalDocument();
        this.win = options.window ?? resolveGlobalWindow(this.doc);
    }

    private win: Window | null = null;
    private doc: Document | null = null;

    init(): void {
        const doc = this.doc;
        if (!doc) return;
        doc.addEventListener("keydown", this.handleKeyDown);
        // 捕获阶段处理编辑器外点击：CodeMirror 会 stopPropagation，冒泡阶段收不到。
        doc.addEventListener("mousedown", this.handleClickOutside, true);
        // 桌面端只用来"发现当前编辑器换了"，弹窗本身由 .cm-content 上的事件驱动。
        if (!Platform.isMobile) {
            doc.addEventListener("mouseup", this.handleEditorDiscovery, true);
        } else {
            doc.addEventListener("selectionchange", this.handleDocumentSelectionChange);
            doc.addEventListener("touchstart", this.handleTouchOutside, { passive: true });
        }
        this.ensureEditorAttached();
    }

    destroy(): void {
        this.detachEditorListeners();
        const doc = this.doc;
        doc?.removeEventListener("keydown", this.handleKeyDown);
        doc?.removeEventListener("mousedown", this.handleClickOutside, true);
        doc?.removeEventListener("mouseup", this.handleEditorDiscovery, true);
        doc?.removeEventListener("selectionchange", this.handleDocumentSelectionChange);
        doc?.removeEventListener("touchstart", this.handleTouchOutside);
        this.outsidePointerDocument?.removeEventListener("pointerdown", this.handlePointerDownOutside, true);
        this.outsidePointerDocument = null;
        this.hide();
    }

    // --- 编辑器挂载 / 卸载 -------------------------------------------------

    /**
     * 把监听挂到当前活动视图的 `.cm-content` 上。
     *
     * 监听 DOM 元素而不是编辑器实例：切笔记、切分屏后旧元素会被销毁，
     * 这里对比后重新挂载，避免监听器泄漏到已销毁的编辑器上。
     */
    private ensureEditorAttached(): void {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        const editorEl = view?.contentEl.querySelector(".cm-content") as HTMLElement | null;
        if (editorEl && editorEl === this.watchedEditorEl) return;

        if (this.isVisible && this.currentView !== view) this.hide();
        this.detachEditorListeners();
        if (!view || !editorEl) return;

        this.watchedEditorEl = editorEl;
        this.bindDesktopOutsidePointerListener(editorEl.ownerDocument);
        editorEl.addEventListener("mouseup", this.handleSelectionChange);
        editorEl.addEventListener("keyup", this.handleSelectionChange);
        if (Platform.isMobile) {
            editorEl.addEventListener("touchstart", this.handleTouchStart, { passive: true });
            editorEl.addEventListener("touchmove", this.handleTouchMove, { passive: true });
            editorEl.addEventListener("touchend", this.handleTouchEnd);
        }
    }

    private detachEditorListeners(): void {
        const el = this.watchedEditorEl;
        if (!el) return;
        el.removeEventListener("mouseup", this.handleSelectionChange);
        el.removeEventListener("keyup", this.handleSelectionChange);
        el.removeEventListener("touchstart", this.handleTouchStart);
        el.removeEventListener("touchmove", this.handleTouchMove);
        el.removeEventListener("touchend", this.handleTouchEnd);
        this.watchedEditorEl = null;
    }

    private bindDesktopOutsidePointerListener(ownerDocument: Document): void {
        if (Platform.isMobile || this.outsidePointerDocument === ownerDocument) return;
        this.outsidePointerDocument?.removeEventListener("pointerdown", this.handlePointerDownOutside, true);
        ownerDocument.addEventListener("pointerdown", this.handlePointerDownOutside, true);
        this.outsidePointerDocument = ownerDocument;
    }

    // --- 触发路径 ---------------------------------------------------------

    private handleEditorDiscovery = (): void => {
        this.ensureEditorAttached();
    };

    private handleSelectionChange = (): void => {
        if (this.shouldIgnoreSelectionChange()) return;
        this.scheduleSelectionCheck();
    };

    private scheduleSelectionCheck(): void {
        const win = this.win;
        if (!win) return;
        if (this.debounceTimer !== null) win.clearTimeout(this.debounceTimer);
        this.debounceTimer = win.setTimeout(() => {
            this.debounceTimer = null;
            this.checkSelection();
        }, SELECTION_TOOLBAR_DELAY_MS);
    }

    private handleTouchStart = (event: TouchEvent): void => {
        const touch = event.touches[0];
        if (!touch) return;
        this.touchStartX = touch.clientX;
        this.touchStartY = touch.clientY;
        this.touchMoved = false;
    };

    private handleTouchMove = (event: TouchEvent): void => {
        const touch = event.touches[0];
        if (!touch) return;
        if (Math.abs(touch.clientX - this.touchStartX) > TOUCH_MOVE_TOLERANCE_PX
            || Math.abs(touch.clientY - this.touchStartY) > TOUCH_MOVE_TOLERANCE_PX) {
            this.touchMoved = true;
        }
    };

    private handleTouchEnd = (): void => {
        if (this.shouldIgnoreSelectionChange()) return;
        if (this.touchMoved) return;
        this.scheduleSelectionCheck();
    };

    private handleDocumentSelectionChange = (): void => {
        if (this.shouldIgnoreSelectionChange()) return;
        if (this.isFocusInsideToolbar()) return;
        const selection = this.win?.getSelection();
        if (!selection || selection.toString().trim().length === 0) return;
        this.ensureEditorAttached();
        this.scheduleSelectionCheck();
    };

    private isFocusInsideToolbar(): boolean {
        const active = this.doc?.activeElement;
        return Boolean(active && active.closest(`.${TOOLBAR_CONTAINER_CLASS}`));
    }

    private checkSelection(): void {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) {
            this.hide();
            return;
        }
        const text = view.editor.getSelection();
        if (text && text.trim().length > 0) {
            this.currentView = view;
            this.currentEditor = view.editor;
            this.show(view, view.editor, text);
        } else {
            this.hide();
        }
    }

    // --- 显示 / 隐藏 -------------------------------------------------------

    private show(view: MarkdownView, editor: Editor, text: string): void {
        const coords = this.getSelectionCoords(editor, view);
        if (!coords) {
            this.hide();
            return;
        }
        this.currentSelectionText = text;
        this.saveCurrentSelectionRange(editor);
        this.render(view, coords);
    }

    private render(view: MarkdownView, coords: SelectionCoords): void {
        this.destroyDom();
        const contentEl = view.contentEl;
        const container = contentEl.createDiv({ cls: TOOLBAR_CONTAINER_CLASS });
        container.toggleClass(`${TOOLBAR_CONTAINER_CLASS}-mobile`, Platform.isMobile);
        container.setCssProps({ position: Platform.isMobile ? "fixed" : "absolute", visibility: "hidden" });
        this.containerEl = container;

        try {
            this.component = mount(SelectionToolbarComponent, {
                target: container,
                props: {
                    actions: [...this.actions],
                    onAction: (actionId: string) => this.handleAction(actionId),
                    onRestoreSelection: () => this.restoreCurrentSelection(),
                },
            });
        } catch {
            this.destroyDom();
            return;
        }

        const win = this.win;
        if (!win) {
            this.destroyDom();
            return;
        }
        // 用实测尺寸做钳制：上游写死 350x60，窄屏与长标签必然溢出。
        win.requestAnimationFrame(() => {
            if (!this.containerEl || !this.component) return;
            this.applyPosition(contentEl, coords);
            this.containerEl.setCssProps({ visibility: "visible" });
            this.isVisible = true;
        });
    }

    private applyPosition(contentEl: HTMLElement, coords: SelectionCoords): void {
        const container = this.containerEl;
        const element = container?.firstElementChild;
        if (!container) return;
        const contentRect = contentEl.getBoundingClientRect();
        const width = element?.getBoundingClientRect().width ?? 0;
        const height = element?.getBoundingClientRect().height ?? 0;

        if (Platform.isMobile) {
            // 移动端不跟选区：钉在内容区顶部（软键盘与滚动都不再影响它）。
            const viewWindow = contentEl.ownerDocument.defaultView;
            const visualTop = viewWindow?.visualViewport?.offsetTop ?? 0;
            const headerEl = contentEl.parentElement?.querySelector<HTMLElement>(".view-header");
            const headerBottom = headerEl?.getBoundingClientRect().bottom ?? contentRect.top;
            const top = Math.max(headerBottom, contentRect.top, visualTop) + TOOLBAR_MARGIN_PX;
            container.setCssProps({
                top: `${top}px`,
                left: `${contentRect.left + contentRect.width / 2}px`,
                transform: "translateX(-50%)",
            });
            return;
        }

        const selectionWidth = coords.right - coords.left;
        const center = (coords.left + coords.right) / 2;
        const centerRatio = coords.textWidth > 0 ? (center - coords.textLeft) / coords.textWidth : 0;
        // 先把选区坐标换成"相对内容区"的坐标。
        const relativeTop = coords.top - contentRect.top;
        const relativeLeft = coords.left - contentRect.left;
        const relativeRight = coords.right - contentRect.left;
        const top = Math.max(MIN_VERTICAL_ROOM_PX, relativeTop - height - TOOLBAR_MARGIN_PX);

        let left = relativeLeft;
        let transform = "none";
        if (coords.isMultiLine || selectionWidth >= coords.textWidth * CENTER_ALIGNMENT_WIDTH_RATIO) {
            left = center - contentRect.left;
            transform = "translateX(-50%)";
        } else if (centerRatio > RIGHT_ALIGNMENT_CENTER_RATIO) {
            left = relativeRight;
            transform = "translateX(-100%)";
        }
        // 视口钳制
        const contentWidth = contentRect.width;
        if (transform === "none" && left + width > contentWidth - TOOLBAR_MARGIN_PX) {
            left = Math.max(TOOLBAR_MARGIN_PX, contentWidth - width - TOOLBAR_MARGIN_PX);
        }
        container.setCssProps({ top: `${top}px`, left: `${left}px`, transform });
    }

    hide(): void {
        if (this.debounceTimer !== null) {
            this.win?.clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        this.destroyDom();
    }

    private destroyDom(): void {
        this.isVisible = false;
        if (this.component) {
            try {
                void unmount(this.component);
            } catch {
                // 卸载失败不影响后续挂载；容器随后会被整体移除。
            }
            this.component = null;
        }
        this.containerEl?.remove();
        this.containerEl = null;
    }

    // --- 交互 -------------------------------------------------------------

    private handleAction(actionId: string): void {
        const editor = this.currentEditor;
        if (!editor) return;
        const selection: SelectionToolbarSelection = {
            text: this.currentSelectionText,
            path: this.currentView?.file?.path ?? null,
            editor,
        };
        // iOS 点按钮会先清掉选区，先把选区还原再交给上层。
        this.restoreCurrentSelection();
        this.onAction(actionId, selection);
        this.hide();
    }

    private handleKeyDown = (event: KeyboardEvent): void => {
        if (event.key === "Escape" && this.containerEl) this.hide();
    };

    private handleClickOutside = (event: MouseEvent): void => {
        if (!this.containerEl) return;
        const target = event.target as HTMLElement | null;
        if (this.markToolbarInteraction(target)) return;
        this.dismissAfterOutsideInteraction();
    };

    private handlePointerDownOutside = (event: PointerEvent): void => {
        if (!this.containerEl || event.pointerType !== "mouse") return;
        if (this.markToolbarInteraction(event.target as HTMLElement | null)) return;
        this.dismissAfterOutsideInteraction();
    };

    private handleTouchOutside = (event: TouchEvent): void => {
        if (!this.containerEl) return;
        if (this.markToolbarInteraction(event.target as HTMLElement | null)) return;
        this.dismissAfterOutsideInteraction();
    };

    private dismissAfterOutsideInteraction(): void {
        this.ignoreSelectionChangeUntil = this.now() + OUTSIDE_DISMISS_GUARD_MS;
        this.hide();
    }

    private markToolbarInteraction(target: HTMLElement | null): boolean {
        if (!target?.closest(`.${TOOLBAR_CONTAINER_CLASS}`)) return false;
        this.ignoreSelectionChangeUntil = this.now() + TOOLBAR_INTERACTION_GUARD_MS;
        return true;
    }

    private now(): number {
        return this.win?.performance.now() ?? Date.now();
    }

    private shouldIgnoreSelectionChange(): boolean {
        return this.now() < this.ignoreSelectionChangeUntil;
    }

    // --- 选区坐标与还原 ---------------------------------------------------

    private saveCurrentSelectionRange(editor: Editor): void {
        const selection = editor.listSelections()[0];
        if (!selection) return;
        this.currentSelectionRange = {
            anchor: { ...selection.anchor },
            head: { ...selection.head },
        };
    }

    /** iOS 在按钮的默认 touchstart 里会清掉选区，用它把选区还原回去。 */
    restoreCurrentSelection(): void {
        const editor = this.currentEditor;
        if (!editor || !this.currentSelectionRange || !this.currentSelectionText) return;
        this.ignoreSelectionChangeUntil = this.now() + TOOLBAR_INTERACTION_GUARD_MS;
        try {
            editor.focus();
            editor.setSelection(this.currentSelectionRange.anchor, this.currentSelectionRange.head);
        } catch {
            // 编辑器已销毁时忽略。
        }
    }

    private getSelectionCoords(editor: Editor, view: MarkdownView): SelectionCoords | null {
        try {
            const cmEditor = (editor as unknown as EditorWithCodeMirror).cm;
            if (!cmEditor) return null;
            const selection = editor.listSelections()[0];
            if (!selection) return null;

            const anchorCoords = cmEditor.coordsAtPos(editor.posToOffset(selection.anchor));
            const headCoords = cmEditor.coordsAtPos(editor.posToOffset(selection.head));
            if (!anchorCoords || !headCoords) return null;

            const contentRect = view.contentEl.getBoundingClientRect();
            // 活动端点已滚出视口时不弹窗，免得浮在无关位置。
            if (headCoords.bottom <= contentRect.top || headCoords.top >= contentRect.bottom) return null;
            const textRect = view.contentEl.querySelector<HTMLElement>(".cm-content")?.getBoundingClientRect();

            return {
                left: Math.min(anchorCoords.left, headCoords.left) - contentRect.left,
                right: Math.max(anchorCoords.right, headCoords.right) - contentRect.left,
                top: headCoords.top - contentRect.top,
                bottom: headCoords.bottom - contentRect.top,
                isMultiLine: anchorCoords.top !== headCoords.top,
                textLeft: (textRect?.left ?? contentRect.left) - contentRect.left,
                textWidth: textRect?.width ?? contentRect.width,
            };
        } catch {
            return null;
        }
    }
}
