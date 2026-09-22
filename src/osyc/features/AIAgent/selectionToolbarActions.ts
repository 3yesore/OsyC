import type { SelectionToolbarAction } from "@/osyc/vendored/smartpick-toolbar/selectionToolbar";

/**
 * 选中内容后浮条上提供的动作。
 *
 * 这里只放"动作 → 提示词"的产品策略；浮条本身的机制在
 * `@/osyc/vendored/smartpick-toolbar/`。图标名必须是 Obsidian 内置图标表里存在的
 * （见 reviewHygiene 的白名单约定）。
 */
export const SELECTION_TOOLBAR_ACTIONS: readonly SelectionToolbarAction[] = [
    { id: "explain", label: "解释", icon: "file-text" },
    { id: "rewrite", label: "改写", icon: "rotate-ccw" },
    { id: "translate", label: "翻译", icon: "refresh-cw" },
    { id: "todos", label: "挑待办", icon: "check" },
];

/** 每个动作对应的提示词。发给服务端时与选区快照一起上行。 */
export const SELECTION_ACTION_PROMPTS: Readonly<Record<string, string>> = {
    explain: "解释我选中的这段内容：它在上下文里起什么作用，有没有前后矛盾或值得追查的地方。只围绕选中内容回答。",
    rewrite: "把选中的这段改写得更简洁清楚，保持原意、术语与 Markdown 结构不变。只输出改写后的文本。",
    translate: "把选中的这段翻译成英文，保留术语、代码与 Markdown 结构不变。只输出译文。",
    todos: "从选中的这段里挑出可以执行的待办，输出 Markdown 复选框列表；没有可执行项就直说没有。",
};

/** 服务端 `SendRequest.message` 上限 2000 字符，留出余量。 */
export const SELECTION_MESSAGE_MAX_CHARS = 1600;

/**
 * 组装这次提问的正文。
 *
 * 选区本身已经由活动笔记快照（`selection.text`）单独上行，所以正常情况下只发提示词。
 * 但快照可能取不到（非 Markdown、超限、设备不支持加密），那种情况下必须把选区
 * 直接写进消息里，否则模型看不到任何内容。这里用截断后的引文兜底。
 */
export function buildSelectionMessage(actionId: string, selectionText: string, snapshotAttached: boolean): string {
    const prompt = SELECTION_ACTION_PROMPTS[actionId];
    if (!prompt) return "";
    const text = selectionText.trim();
    if (snapshotAttached || !text) return prompt;
    const quoteBudget = Math.max(0, SELECTION_MESSAGE_MAX_CHARS - prompt.length - 24);
    const quoted = text.length > quoteBudget ? text.slice(0, quoteBudget) + "…" : text;
    return `${prompt}\n\n【选中内容】\n${quoted}`;
}
