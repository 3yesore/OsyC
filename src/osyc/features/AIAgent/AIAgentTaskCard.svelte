<script lang="ts">
    import { isSyncFailed, type AITask } from "./CmdAIAgent";
    import { visibleProgressEvents } from "./conversationModel";
    import { isDiagnosticEligible } from "./diagnosticsUpload";

    interface Props {
        task: AITask;
        onOpenFile?: (path: string) => void;
        onRetryPush?: (taskId: string) => void;
        onConfirmTask?: (taskId: string) => Promise<{ ok: boolean; message: string }> | void;
        onCancelConfirmation?: (taskId: string) => Promise<{ ok: boolean; message: string }> | void;
        onUploadDiagnostics?: (task: AITask) => Promise<{ ok: boolean; message: string }>;
    }
    let { task, onOpenFile, onRetryPush, onConfirmTask, onCancelConfirmation, onUploadDiagnostics }: Props = $props();

    const STATUS_META = {
        queued: { icon: "⏳", label: "排队中" },
        running: { icon: "🔄", label: "执行中" },
        done: { icon: "✅", label: "已完成" },
        failed: { icon: "⚠️", label: "失败" },
        awaiting_confirmation: { icon: "❔", label: "待确认" },
        conflict: { icon: "⚠️", label: "冲突" },
        interrupted: { icon: "⏸", label: "已中断" },
        failed_zero_cost: { icon: "⚠️", label: "未完成" },
        delivery_failed: { icon: "⚠️", label: "交付失败" },
        cancelled: { icon: "○", label: "已取消" },
    } as const;

    let meta = $derived(STATUS_META[task.status]);
    // 预估值只用于排队/执行中的提示。失败任务没有扣费，不能把 estCost
    // 当成实际消费展示；完成任务只显示服务端确认的 actualCost。
    let estimated = $derived(task.status === "queued" || task.status === "running");
    let cost = $derived(estimated ? (task.estCost ?? 0) : (task.actualCost ?? 0));
    let syncFailed = $derived(isSyncFailed(task));
    let confirming = $state(false);
    let confirmationMessage = $state("");
    let uploadingDiagnostics = $state(false);
    let diagnosticsMessage = $state("");
    const ACTION_LABEL: Record<string, string> = {
        write_note: "写入笔记",
        delete_note: "删除笔记",
        move_note: "移动笔记",
        rename_note: "重命名笔记",
    };
    let confirmationPath = $derived(typeof task.confirmation?.payload?.path === "string"
        ? String(task.confirmation.payload.path)
        : typeof task.confirmation?.payload?.source === "string"
          ? String(task.confirmation.payload.source)
          : "当前笔记");
    let confirmationAction = $derived(ACTION_LABEL[task.confirmation?.action ?? ""] ?? "修改笔记");
    async function confirm() {
        if (!onConfirmTask || confirming) return;
        confirming = true; confirmationMessage = "";
        try { const result = await onConfirmTask(task.taskId); confirmationMessage = result?.message ?? ""; }
        finally { confirming = false; }
    }
    async function cancel() {
        if (!onCancelConfirmation || confirming) return;
        confirming = true; confirmationMessage = "";
        try { const result = await onCancelConfirmation(task.taskId); confirmationMessage = result?.message ?? ""; }
        finally { confirming = false; }
    }
    async function uploadDiagnostics() {
        if (!onUploadDiagnostics || uploadingDiagnostics) return;
        uploadingDiagnostics = true; diagnosticsMessage = "";
        try { diagnosticsMessage = (await onUploadDiagnostics(task)).message; }
        finally { uploadingDiagnostics = false; }
    }
    let progressEvents = $derived(visibleProgressEvents(task.progressEvents, task.status));
    let displayProgressEvents = $derived(
        progressEvents
            .filter((event, index, all) =>
                all.findIndex((other) =>
                    other.phase === event.phase &&
                    other.message === event.message &&
                    other.count === event.count
                ) === index
            )
            .slice(-6)
    );
    let timeText = $derived(
        new Date(task.createdAt).toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
        })
    );
</script>

<article class="ai-task-card ai-status-{task.status}">
    <div class="ai-task-head">
        <span class="ai-task-icon" aria-hidden="true">{meta.icon}</span>
        <span class="ai-task-message ai-rich-content">{task.message}</span>
        <span class="ai-task-time">{timeText}</span>
    </div>

    {#if task.progress}
        <div class="ai-task-progress">{task.progress}</div>
    {/if}

    {#if task.status === "awaiting_confirmation" && task.confirmation}
        <section class="ai-confirmation" aria-label="等待确认">
            <div class="ai-confirmation-title">需要确认：{confirmationAction}</div>
            <div class="ai-confirmation-path">{confirmationPath}</div>
            <div class="ai-confirmation-note">确认后只执行这一次操作，不会重新调用模型。</div>
            <div class="ai-confirmation-actions">
                <button class="ai-btn ai-btn-primary" disabled={confirming} onclick={confirm}>{confirming ? "处理中…" : "确认执行"}</button>
                <button class="ai-btn" disabled={confirming} onclick={cancel}>取消操作</button>
            </div>
            {#if confirmationMessage}<div class="ai-confirmation-message">{confirmationMessage}</div>{/if}
        </section>
    {/if}

    {#if progressEvents.length > 0}
        <details class="ai-task-trace" open={task.status === "running"}>
            <summary>处理过程</summary>
            <div class="ai-task-trace-list">
                {#each displayProgressEvents as event}
                    <div class="ai-task-trace-event">
                        <span class="ai-task-trace-dot" aria-hidden="true"></span>
                        <span>{event.message}{event.count ? ` · ${event.count} 项` : ""}</span>
                    </div>
                {/each}
            </div>
        </details>
    {/if}

    {#if task.responseText}
        <section class="ai-task-response" aria-label="OC 回复">
            <div class="ai-task-response-label">OC 回复</div>
            <div class="ai-task-response-content ai-rich-content">{task.responseText}</div>
        </section>
    {/if}

    {#if task.filesChanged && task.filesChanged.length > 0}
        <div class="ai-task-files">
            <span class="ai-task-files-label">已生成：</span>
            {#each task.filesChanged as file}
                <button class="ai-task-file" onclick={() => onOpenFile?.(file)}>
                    <span aria-hidden="true">📄</span>{file}
                </button>
            {/each}
        </div>
    {/if}

    <div class="ai-task-foot">
        <span class="ai-task-status">{meta.label}</span>
        <span class="ai-task-costs">
            {#if cost > 0}
                <span class="ai-task-cost">
                    {estimated ? "预计 " : ""}-{cost} 积分
                </span>
            {/if}
        </span>
    </div>

    {#if syncFailed}
        <div class="ai-task-syncfail">
            <span>笔记已生成，但未能同步回你的笔记库</span>
            <button class="ai-text-btn" onclick={() => onRetryPush?.(task.taskId)}>点此重试</button>
        </div>
    {/if}

    {#if task.status === "failed" && task.error}
        <div class="ai-task-error">{task.error}</div>
    {/if}
    {#if (task.status === "conflict" || task.status === "failed_zero_cost" || task.status === "cancelled") && task.error}
        <div class="ai-task-error">{task.error}</div>
    {/if}
    {#if isDiagnosticEligible(task) && onUploadDiagnostics}
        <div class="ai-task-error"><button class="ai-text-btn" disabled={uploadingDiagnostics} onclick={uploadDiagnostics}>{uploadingDiagnostics ? "上传中…" : "上传脱敏诊断"}</button>{#if diagnosticsMessage}<span>{diagnosticsMessage}</span>{/if}</div>
    {/if}

    {#if task.status === "done" && task.deliveryStatus === "delivered"}
        <div class="ai-task-delivery ai-task-delivery-success">已写入笔记库</div>
    {:else if task.status === "done" && task.deliveryStatus === "pending"}
        <div class="ai-task-delivery">服务器已生成，正在写入手机笔记库…</div>
    {:else if task.status === "done" && task.deliveryStatus === "failed"}
        <div class="ai-task-delivery ai-task-delivery-error">服务器已生成，但手机写入失败，请重试交付。</div>
    {:else if task.status === "done" && task.deliveryStatus === "conflict"}
        <div class="ai-task-delivery ai-task-delivery-error">手机存在同名不同内容，未覆盖原文件。</div>
    {/if}
</article>

<style>
    .ai-task-card {
        min-width: 0;
        overflow: hidden;
        color: var(--text-normal);
    }
    .ai-task-card.ai-status-running {
        border-left-color: var(--interactive-accent);
    }
    .ai-task-card.ai-status-running .ai-task-icon {
        animation: ai-spin 1.2s linear infinite;
        display: inline-block;
    }
    @keyframes ai-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
    .ai-task-card.ai-status-done {
        border-left-color: var(--color-green);
    }
    .ai-task-card.ai-status-failed {
        border-left-color: var(--color-red);
    }
    .ai-task-head {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        min-width: 0;
    }
    .ai-task-icon {
        flex: 0 0 auto;
        font-size: 14px;
        line-height: 1.5;
    }
    .ai-task-message {
        flex: 1 1 auto;
        word-break: break-word;
        color: var(--text-normal);
        font-size: var(--font-ui-small);
        line-height: 1.4;
    }
    .ai-task-time {
        flex: 0 0 auto;
        font-size: var(--font-ui-smaller);
        color: var(--text-faint);
        line-height: 1.5;
        white-space: nowrap;
    }
    .ai-task-progress {
        margin-top: 6px;
        padding-left: 22px;
        font-size: var(--font-ui-smaller);
        color: var(--text-muted);
    }
    .ai-task-trace {
        margin: 8px 0 0 22px;
        color: var(--text-muted);
        font-size: var(--font-ui-smaller);
    }
    .ai-task-trace summary { cursor: pointer; color: var(--text-accent); }
    .ai-task-trace-list { display: grid; gap: 4px; padding: 6px 0 0 2px; }
    .ai-task-trace-event { display: flex; align-items: center; gap: 6px; line-height: 1.4; }
    .ai-task-trace-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--interactive-accent); flex: 0 0 auto; }
    .ai-task-response {
        margin: 10px 0 0 22px;
        padding: 0;
        border-left: 0;
        border-radius: 0;
        background: transparent;
    }
    .ai-task-response-label {
        margin-bottom: 6px;
        color: var(--text-accent);
        font-size: var(--font-ui-smaller);
        font-weight: 600;
    }
    .ai-task-response-content {
        /* The chat timeline is the only scroll container. Let streamed text
         * grow naturally so long replies never become a nested scroll box. */
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        color: var(--text-normal);
        font-size: var(--font-ui-small);
        line-height: 1.55;
    }
    .ai-task-delivery { margin-top: 8px; font-size: var(--font-ui-smaller); color: var(--text-muted); }
    .ai-task-delivery-error { color: var(--color-orange); }
    .ai-task-files {
        margin-top: 8px;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 8px;
    }
    .ai-task-files-label {
        font-size: var(--font-ui-smaller);
        color: var(--text-faint);
    }
    .ai-task-file {
        background: none;
        border: none;
        box-shadow: none;
        padding: 2px 0;
        cursor: pointer;
        font-size: var(--font-ui-smaller);
        color: var(--text-accent);
        display: inline-flex;
        align-items: center;
        gap: 3px;
    }
    .ai-task-file:hover {
        text-decoration: underline;
    }
    .ai-task-foot {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid var(--background-modifier-border);
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: var(--font-ui-smaller);
        color: var(--text-faint);
    }
    .ai-task-costs {
        display: inline-flex;
        align-items: center;
        gap: 8px;
    }
    .ai-task-cost-quota {
        color: var(--text-accent);
    }
    .ai-task-syncfail {
        margin-top: 8px;
        padding: 8px 10px;
        border-radius: 6px;
        background-color: var(--background-modifier-error);
        font-size: var(--font-ui-smaller);
        color: var(--text-normal);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
    }
    .ai-text-btn {
        background: none;
        border: none;
        box-shadow: none;
        padding: 0;
        cursor: pointer;
        color: var(--text-accent);
        font-size: var(--font-ui-smaller);
        font-weight: 500;
    }
    .ai-text-btn:hover {
        text-decoration: underline;
    }
    .ai-task-error {
        margin-top: 6px;
        font-size: var(--font-ui-smaller);
        color: var(--text-error);
    }
    .ai-confirmation {
        margin: 10px 0 0 22px;
        padding: 10px;
        border: 1px solid var(--background-modifier-border);
        border-left: 3px solid var(--interactive-accent);
        border-radius: 6px;
    }
    .ai-confirmation-title { color: var(--text-normal); font-weight: 600; }
    .ai-confirmation-path { margin-top: 4px; color: var(--text-accent); overflow-wrap: anywhere; }
    .ai-confirmation-note { margin-top: 4px; color: var(--text-muted); font-size: var(--font-ui-smaller); }
    .ai-confirmation-actions { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
    .ai-confirmation-message { margin-top: 6px; color: var(--text-muted); font-size: var(--font-ui-smaller); }


/* ---- 触摸适配 ----
 * 手机是主要使用场景。两条硬要求：
 * 1) 触摸目标不小于 44px（Obsidian 官方规范），否则手指点不准
 * 2) 输入框字号不小于 16px —— iOS 上小于这个值，聚焦时页面会自动放大
 */
@media (max-width: 600px) {
    .ai-text-btn {
        min-height: 44px;
        padding: 0 12px;
        display: inline-flex;
        align-items: center;
    }
    .ai-task-file {
        min-height: 44px;
        display: flex;
        align-items: center;
    }
}
</style>
