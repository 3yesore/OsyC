export interface MarkdownThemeLeaf {
    view?: {
        containerEl?: {
            classList: {
                toggle(className: string, force?: boolean): void;
            };
            querySelectorAll?: (selectors: string) => ArrayLike<{
                classList?: {
                    toggle(className: string, force?: boolean): void;
                };
            }>;
        };
    };
}

export interface MarkdownThemeWorkspace {
    getLeavesOfType(type: string): MarkdownThemeLeaf[];
}

/** Keep note styling opt-in and local to Markdown view containers. */
export function syncMarkdownThemeScope(workspace: MarkdownThemeWorkspace, enabled: boolean): void {
    for (const leaf of workspace.getLeavesOfType("markdown")) {
        const container = leaf.view?.containerEl;
        if (!container) continue;
        container.classList.toggle("osyc-theme-notes", enabled);
        const roots = container.querySelectorAll?.(
            ".view-content, .markdown-preview-view, .markdown-rendered, .markdown-source-view, .cm-editor, .cm-scroller"
        ) ?? [];
        for (const root of Array.from(roots)) {
            root.classList?.toggle("osyc-theme-notes", enabled);
        }
    }
}
