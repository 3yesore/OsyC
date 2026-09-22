<script lang="ts">
    import { Platform } from "@/deps.ts";
    import OsycIcon from "@/osyc/features/AIAgent/OsycIcon.svelte";

    export interface SelectionToolbarAction {
        id: string;
        label: string;
        icon: string;
    }

    interface Props {
        actions: SelectionToolbarAction[];
        onAction: (actionId: string) => void;
        /** iOS 上按钮的 touchstart 会清掉编辑器选区，点击前先请控制器还原。 */
        onRestoreSelection: () => void;
    }

    let { actions, onAction, onRestoreSelection }: Props = $props();

    let suppressSyntheticClick = false;
    let clearGuardTimer: number | null = null;

    /**
     * 触摸守卫：iOS/iPadOS 在按钮的默认 touchstart 里会转移焦点并清掉选区，
     * 于是"点了按钮但没选中内容"。这里阻止默认行为并还原选区，
     * 同时把随后合成的 click 抑制掉——否则一次点击会触发两次动作。
     * 逻辑改写自 SmartPick `src/toolbar/ToolbarUI.ts:325-361`（MIT）。
     */
    function touchGuard(node: HTMLButtonElement) {
        const handleTouchStart = (event: TouchEvent) => {
            if (!Platform.isMobile) return;
            event.preventDefault();
            event.stopPropagation();
            onRestoreSelection();
        };
        const handleTouchEnd = (event: TouchEvent) => {
            if (!Platform.isMobile) return;
            event.preventDefault();
            event.stopPropagation();
            suppressSyntheticClick = true;
            if (clearGuardTimer !== null) window.clearTimeout(clearGuardTimer);
            clearGuardTimer = window.setTimeout(() => {
                suppressSyntheticClick = false;
                clearGuardTimer = null;
            }, 400);
        };

        node.addEventListener("touchstart", handleTouchStart, { passive: false });
        node.addEventListener("touchend", handleTouchEnd, { passive: false });
        return {
            destroy() {
                node.removeEventListener("touchstart", handleTouchStart);
                node.removeEventListener("touchend", handleTouchEnd);
            },
        };
    }

    function handleClick(actionId: string) {
        if (suppressSyntheticClick) return;
        onAction(actionId);
    }
</script>

<div class="osyc-selection-toolbar" role="toolbar" aria-label="对选中内容提问">
    {#each actions as action (action.id)}
        <button
            type="button"
            class="osyc-selection-toolbar-button"
            title={action.label}
            aria-label={action.label}
            use:touchGuard
            onclick={() => handleClick(action.id)}
        >
            <OsycIcon name={action.icon} size={15} />
            <span class="osyc-selection-toolbar-label">{action.label}</span>
        </button>
    {/each}
</div>

<style>
    .osyc-selection-toolbar {
        display: flex;
        align-items: center;
        gap: 2px;
        padding: 4px;
        border: 1px solid var(--background-modifier-border);
        border-radius: 8px;
        background-color: var(--background-primary);
        box-shadow: var(--shadow-s);
        /* 移动端横向可滚：按钮再多也不会把浮条撑出屏幕。 */
        max-width: min(100%, 92vw);
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
    }

    .osyc-selection-toolbar-button {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        /* 36px 触控目标：低于这个尺寸移动端点不准。 */
        min-height: 36px;
        padding: 0 10px;
        border: none;
        border-radius: 6px;
        background-color: transparent;
        box-shadow: none;
        color: var(--text-normal);
        font-size: var(--font-ui-small);
        white-space: nowrap;
        cursor: pointer;
    }

    .osyc-selection-toolbar-button:hover,
    .osyc-selection-toolbar-button:focus-visible {
        background-color: var(--background-modifier-hover);
        color: var(--text-normal);
    }

    .osyc-selection-toolbar-label {
        line-height: 1;
    }
</style>
