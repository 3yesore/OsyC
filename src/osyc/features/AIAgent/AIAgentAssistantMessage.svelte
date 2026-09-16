<script lang="ts">
    import { App, Component, MarkdownRenderer } from "@/deps.ts";
    import { isSyncFailed, type AITask } from "./CmdAIAgent";
    import { mergeModelOutputEvents, visibleProgressEvents } from "./conversationModel";
    import { isDiagnosticEligible } from "./diagnosticsUpload";
    import OsycIcon from "./OsycIcon.svelte";

    interface Props {
        app: App;
        task: AITask;
        onOpenFile?: (path: string) => void;
        onRetryPush?: (taskId: string) => void;
        onConfirmTask?: (taskId: string) => Promise<{ ok: boolean; message: string }> | void;
        onCancelConfirmation?: (taskId: string) => Promise<{ ok: boolean; message: string }> | void;
        onUploadDiagnostics?: (task: AITask) => Promise<{ ok: boolean; message: string }>;
    }

    let { app, task, onOpenFile, onRetryPush, onConfirmTask, onCancelConfirmation, onUploadDiagnostics }: Props = $props();

    const STATUS_LABEL: Record<string, string> = {
        queued: "准备中", running: "生成中", done: "完成", failed: "失败",
        awaiting_confirmation: "等待确认", conflict: "存在冲突", interrupted: "已中断",
        failed_zero_cost: "未完成", delivery_failed: "交付失败", cancelled: "已取消",
    };
    const ACTION_LABEL: Record<string, string> = {
        write_note: "写入笔记", delete_note: "删除笔记", move_note: "移动笔记", rename_note: "重命名笔记",
    };
    // These were legacy server fallbacks, not an actual model or tool result.
    // Keep filtering them during the rollout so an old API cannot regress chat.
    const FIXED_PROGRESS_MESSAGES = new Set(["正在执行整理步骤", "已完成一个整理步骤"]);

    let confirming = $state(false);
    let uploadingDiagnostics = $state(false);
    let diagnosticsMessage = $state("");
    let confirmationMessage = $state("");
    let estimated = $derived(task.status === "queued" || task.status === "running");
    let cost = $derived(estimated ? (task.estCost ?? 0) : (task.actualCost ?? 0));
    let syncFailed = $derived(isSyncFailed(task));
    let progressEvents = $derived(visibleProgressEvents(task.progressEvents, task.status));
    // Keep the merged public text available after terminal filtering for old
    // gateways that never persisted response_text. Event rows themselves are
    // still removed at terminal state.
    let liveOutputText = $derived(mergeModelOutputEvents(task.progressEvents));
    let liveActivityEvents = $derived(
        progressEvents
            .filter((event) => event.phase === "model_activity")
            .slice(-8)
    );
    // Tool Bridge emits these only after a real, allowlisted operation. Keep
    // them visible beside the streamed reply rather than hiding them once a
    // public model delta arrives.
    let liveToolEvents = $derived(
        progressEvents
            .filter((event) => event.phase === "model_activity" || event.phase === "reading")
            .filter((event, index, all) => all.findIndex((other) =>
                other.phase === event.phase && other.message === event.message && other.count === event.count
            ) === index)
            .slice(-8)
    );
    let displayProgressEvents = $derived(
        progressEvents
            .filter((event) => event.phase !== "model_activity" && event.phase !== "model_output")
            .filter((event) => !FIXED_PROGRESS_MESSAGES.has(event.message))
            .filter((event, index, all) => all.findIndex((other) =>
                other.phase === event.phase && other.message === event.message && other.count === event.count
            ) === index)
            .slice(-6)
    );
    let confirmationPath = $derived(typeof task.confirmation?.payload?.path === "string"
        ? String(task.confirmation.payload.path)
        : typeof task.confirmation?.payload?.source === "string"
          ? String(task.confirmation.payload.source)
          : "当前笔记");
    let confirmationAction = $derived(ACTION_LABEL[task.confirmation?.action ?? ""] ?? "修改笔记");
    let statusLabel = $derived(STATUS_LABEL[task.status] ?? "处理中");
    let renderedContentEl = $state<HTMLDivElement | undefined>();
    let renderGeneration = 0;

    $effect(() => {
        const text = (task.responseText || liveOutputText).trim();
        const target = renderedContentEl;
        if (!target || !text) return;
        const generation = ++renderGeneration;
        const component = new Component();
        target.empty();
        void MarkdownRenderer.render(app, text, target, "/", component).catch(() => {
            if (generation === renderGeneration) target.setText(text);
        });
        return () => {
            component.unload();
            if (generation === renderGeneration) target.empty();
        };
    });

    async function confirm() {
        if (!onConfirmTask || confirming) return;
        confirming = true; confirmationMessage = "";
        try { confirmationMessage = (await onConfirmTask(task.taskId))?.message ?? ""; }
        finally { confirming = false; }
    }
    async function cancel() {
        if (!onCancelConfirmation || confirming) return;
        confirming = true; confirmationMessage = "";
        try { confirmationMessage = (await onCancelConfirmation(task.taskId))?.message ?? ""; }
        finally { confirming = false; }
    }
    async function uploadDiagnostics() {
        if (!onUploadDiagnostics || uploadingDiagnostics) return;
        uploadingDiagnostics = true; diagnosticsMessage = "";
        try { diagnosticsMessage = (await onUploadDiagnostics(task)).message; }
        finally { uploadingDiagnostics = false; }
    }
</script>

<div class="ai-assistant-message ai-status-{task.status}" data-response-text={task.responseText ?? ""} data-progress-events={progressEvents.length}>
    <div class="ai-assistant-head">
        <span class="ai-oc-avatar" aria-hidden="true">OC</span>
        <span class="ai-assistant-status">{statusLabel}</span>
    </div>

    {#if liveOutputText && !task.responseText}
        <div bind:this={renderedContentEl} class="ai-assistant-content ai-rich-content" aria-label="OC 实时输出"></div>
    {:else if liveActivityEvents.length > 0 && !task.responseText}
        <div class="ai-assistant-live-stream ai-rich-content" aria-label="OC 实时输出">
            {#each liveActivityEvents as event}
                <div class="ai-assistant-live-line">{event.message}</div>
            {/each}
        </div>
    {/if}

    {#if task.responseText}
        <div bind:this={renderedContentEl} class="ai-assistant-content ai-rich-content" aria-label="OC 回复"></div>
    {:else if !liveOutputText && liveActivityEvents.length === 0 && (task.status === "queued" || task.status === "running")}
        <div class="ai-assistant-placeholder">OC 正在准备回复…</div>
    {/if}

    {#if liveToolEvents.length > 0}
        <div class="ai-assistant-activity" aria-label="OC 已执行的操作">
            {#each liveToolEvents as event}
                <div class="ai-assistant-activity-row"><span class="ai-assistant-activity-dot" aria-hidden="true"></span><span>{event.message}{event.count ? ` · ${event.count} 项` : ""}</span></div>
            {/each}
        </div>
    {/if}

    {#if (task.status === "queued" || task.status === "running") && task.progress && !FIXED_PROGRESS_MESSAGES.has(task.progress) && liveToolEvents.length === 0 && displayProgressEvents.length === 0}
        <div class="ai-assistant-activity"><span class="ai-assistant-activity-dot" aria-hidden="true"></span><span>{task.progress}</span></div>
    {/if}
    {#if displayProgressEvents.length > 0}
        <div class="ai-assistant-activity" aria-label="处理过程">
            {#each displayProgressEvents as event}
                <div class="ai-assistant-activity-row"><span class="ai-assistant-activity-dot" aria-hidden="true"></span><span>{event.message}{event.count ? ` · ${event.count} 项` : ""}</span></div>
            {/each}
        </div>
    {/if}

    {#if task.status === "awaiting_confirmation" && task.confirmation}
        <section class="ai-assistant-confirmation" aria-label="等待确认">
            <div><strong>需要确认：{confirmationAction}</strong><span>{confirmationPath}</span></div>
            <p>确认后只执行这一次操作，不会重新调用模型。</p>
            <div class="ai-assistant-actions">
                <button class="ai-btn ai-btn-primary" disabled={confirming} onclick={confirm}>{confirming ? "处理中…" : "确认执行"}</button>
                <button class="ai-btn" disabled={confirming} onclick={cancel}>取消操作</button>
            </div>
            {#if confirmationMessage}<div class="ai-assistant-note">{confirmationMessage}</div>{/if}
        </section>
    {/if}

    {#if task.filesChanged && task.filesChanged.length > 0}
        <div class="ai-assistant-artifact" aria-label="生成的文件">
            <span class="ai-assistant-artifact-label">已生成</span>
            {#each task.filesChanged as file}
                <button class="ai-assistant-file" onclick={() => onOpenFile?.(file)}><OsycIcon name="file-text" size={14} /><span>{file}</span></button>
            {/each}
        </div>
    {/if}

    {#if cost > 0 || task.status === "done"}
        <div class="ai-assistant-meta">
            <span>{statusLabel}</span>
            {#if cost > 0}<span>{estimated ? "预计 " : ""}-{cost} 积分</span>{/if}
        </div>
    {/if}

    {#if syncFailed}
        <div class="ai-assistant-error"><OsycIcon name="alert-triangle" size={14} /><span>笔记已生成，但未能写入手机笔记库</span><button class="ai-text-btn" onclick={() => onRetryPush?.(task.taskId)}>重试交付</button></div>
    {/if}
    {#if (task.status === "failed" || task.status === "conflict" || task.status === "failed_zero_cost" || task.status === "cancelled") && task.error}
        <div class="ai-assistant-error"><OsycIcon name="alert-triangle" size={14} /><span>{task.error}</span></div>
    {/if}
    {#if isDiagnosticEligible(task) && onUploadDiagnostics}
        <div class="ai-assistant-error"><button class="ai-text-btn" disabled={uploadingDiagnostics} onclick={uploadDiagnostics}>{uploadingDiagnostics ? "上传中…" : "上传脱敏诊断"}</button>{#if diagnosticsMessage}<span>{diagnosticsMessage}</span>{/if}</div>
    {/if}
    {#if task.status === "done" && task.deliveryStatus === "pending"}
        <div class="ai-assistant-delivery"><OsycIcon name="clock" size={13} /><span>服务器已生成，正在写入手机笔记库…</span></div>
    {:else if task.status === "done" && task.deliveryStatus === "delivered"}
        <div class="ai-assistant-delivery ai-assistant-delivery-success"><OsycIcon name="check" size={13} /><span>已写入笔记库</span></div>
    {:else if task.status === "done" && task.deliveryStatus === "failed"}
        <div class="ai-assistant-delivery ai-assistant-delivery-error"><OsycIcon name="alert-triangle" size={13} /><span>服务器已生成，但手机写入失败，请重试交付。</span></div>
    {:else if task.status === "done" && task.deliveryStatus === "conflict"}
        <div class="ai-assistant-delivery ai-assistant-delivery-error"><OsycIcon name="alert-triangle" size={13} /><span>手机存在同名不同内容，未覆盖原文件。</span></div>
    {/if}
</div>

<style>
    .ai-assistant-message { width: 100%; min-width: 0; color: var(--text-normal); }
    .ai-assistant-head { display: flex; align-items: center; gap: 7px; min-height: 24px; }
    .ai-assistant-status { color: var(--text-faint); font-size: var(--font-ui-smaller); }
    .ai-assistant-content { margin: 8px 0 0 30px; overflow-wrap: anywhere; font-size: var(--font-ui-small); line-height: 1.75; }
    .ai-assistant-content :global(p) { margin: 0 0 0.85em; }
    .ai-assistant-content :global(p:last-child) { margin-bottom: 0; }
    .ai-assistant-content :global(h1), .ai-assistant-content :global(h2), .ai-assistant-content :global(h3), .ai-assistant-content :global(h4) { margin: 1.15em 0 0.45em; line-height: 1.3; }
    .ai-assistant-content :global(h1:first-child), .ai-assistant-content :global(h2:first-child), .ai-assistant-content :global(h3:first-child) { margin-top: 0; }
    .ai-assistant-content :global(ul), .ai-assistant-content :global(ol) { margin: 0.4em 0 0.85em; padding-inline-start: 1.35em; }
    .ai-assistant-content :global(li + li) { margin-top: 0.25em; }
    .ai-assistant-content :global(blockquote) { margin: 0.7em 0; padding-inline-start: 0.9em; border-inline-start: 3px solid var(--interactive-accent); color: var(--text-muted); }
    .ai-assistant-content :global(pre) { max-width: 100%; overflow-x: auto; padding: 0.75em; border-radius: 6px; background: var(--background-secondary); }
    .ai-assistant-content :global(code) { font-family: var(--font-monospace); }
    .ai-assistant-content :global(table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
    .ai-assistant-content :global(th), .ai-assistant-content :global(td) { padding: 0.35em 0.55em; border: 1px solid var(--background-modifier-border); text-align: start; }
    .ai-assistant-live-stream { display: grid; gap: 8px; margin: 8px 0 0 30px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--font-ui-small); line-height: 1.65; }
    .ai-assistant-live-line { min-height: 1.65em; }
    .ai-assistant-placeholder { margin: 8px 0 0 30px; color: var(--text-muted); font-size: var(--font-ui-small); }
    .ai-assistant-activity { display: grid; gap: 4px; margin: 10px 0 0 30px; color: var(--text-muted); font-size: var(--font-ui-smaller); }
    .ai-assistant-activity-row { display: flex; align-items: baseline; gap: 7px; line-height: 1.45; }
    .ai-assistant-activity-dot { display: inline-block; width: 5px; height: 5px; flex: 0 0 auto; border-radius: 50%; background: var(--interactive-accent); }
    .ai-assistant-confirmation { margin: 12px 0 0 30px; padding: 10px 0; border-top: 1px solid var(--background-modifier-border); border-bottom: 1px solid var(--background-modifier-border); }
    .ai-assistant-confirmation > div:first-child { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
    .ai-assistant-confirmation strong { font-size: var(--font-ui-small); }
    .ai-assistant-confirmation span, .ai-assistant-confirmation p, .ai-assistant-note { color: var(--text-muted); font-size: var(--font-ui-smaller); }
    .ai-assistant-confirmation p { margin: 5px 0 0; }
    .ai-assistant-actions { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
    .ai-assistant-artifact { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 9px; margin: 12px 0 0 30px; padding-top: 9px; border-top: 1px solid var(--background-modifier-border); font-size: var(--font-ui-smaller); }
    .ai-assistant-artifact-label { color: var(--text-faint); }
    .ai-assistant-file { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; border: 0; padding: 2px 0; color: var(--text-accent); background: transparent; cursor: pointer; font: inherit; }
    .ai-assistant-file:hover { text-decoration: underline; }
    .ai-assistant-meta { display: flex; justify-content: space-between; gap: 10px; margin: 12px 0 0 30px; padding-top: 8px; border-top: 1px solid var(--background-modifier-border); color: var(--text-faint); font-size: var(--font-ui-smaller); }
    .ai-assistant-error, .ai-assistant-delivery { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 8px 0 0 30px; color: var(--text-muted); font-size: var(--font-ui-smaller); }
    .ai-assistant-error { color: var(--text-error); }
    .ai-assistant-delivery-success { color: var(--text-success, var(--color-green)); }
    .ai-assistant-delivery-error { color: var(--text-warning, var(--color-orange)); }
    @media (max-width: 600px) { .ai-assistant-file { min-height: 44px; } }
</style>
