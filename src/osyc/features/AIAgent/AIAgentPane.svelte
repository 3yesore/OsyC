<script module lang="ts">
    declare const MANIFEST_VERSION: string | undefined;
</script>

<script lang="ts">
    import { onMount } from "svelte";
    import type { App } from "@/deps.ts";
    import type { Writable } from "svelte/store";
    import type { AISnippet, AITask, AIAgentState } from "./CmdAIAgent";
    import AIAgentAssistantMessage from "./AIAgentAssistantMessage.svelte";
    import { buildConversationMessages, shouldFollowTimeline } from "./conversationModel";
    import { buildAppearanceDiagnostics } from "./appearanceDiagnostics";
    import { osycLogger } from "@/osyc/serviceFeatures/osycLogger";

    interface Props {
        app: App;
        tasks: Writable<AITask[]>;
        agentState: Writable<AIAgentState>;
        isMock: boolean;
        onSend: (message: string) => void;
        onActivate: (cardKey: string) => Promise<{ ok: boolean; message: string }>;
        onClear: () => void;
        onOpenFile: (path: string) => void;
        onOpenSettings: () => void;
        onDeactivate: () => void;
        onOpenAccount: () => void;
        onCloudBackup: () => Promise<{ ok: boolean; message: string }>;
        onCloudRestore: (snapshotId: string, overwrite: boolean) => Promise<{ ok: boolean; message: string }>;
        onLoadCloudVault: () => void;
        onRetryPush: (taskId: string) => void;
        onConfirmTask: (taskId: string) => Promise<{ ok: boolean; message: string }>;
        onCancelConfirmation: (taskId: string) => Promise<{ ok: boolean; message: string }>;
        onRecharge: (cardKey: string) => Promise<{ ok: boolean; message: string }>;
        onApplySettingsPatch: (patch: Record<string, unknown>) => Promise<{ applied: number; rejected: { key: string; reason: string }[] }>;
        onApplyThemeSnippet: (snippet: AISnippet) => Promise<{ ok: boolean; message: string }>;
        onMarkOnboarded: () => void;
    }

    let {
        app, tasks, agentState, isMock, onSend, onActivate, onClear, onOpenFile,
        onOpenSettings, onDeactivate, onOpenAccount, onCloudBackup, onCloudRestore,
        onLoadCloudVault, onRetryPush, onConfirmTask, onCancelConfirmation, onRecharge, onApplySettingsPatch,
        onApplyThemeSnippet, onMarkOnboarded,
    }: Props = $props();

    const QUICK_COMMANDS = [
        "整理本周新增笔记，生成一份摘要",
        "把散落的待办汇总成一个清单",
    ];
    const PLAN_LABEL: Record<string, string> = { base: "基础版", member: "会员", pro: "Pro" };
    const SYNC_STATUS_LABEL: Record<string, string> = {
        ok: "同步",
        degraded: "同步降级",
        failed: "同步失败",
        unknown: "同步未知",
    };
    const SETTING_LABELS: Record<string, string> = {
        batchSave: "批量保存", suspendFileWatching: "暂停文件监听",
        watchInternalFileChanges: "监听配置变化", useIndexedDBAdapter: "本地数据库适配器",
        disableCheckingConfigMismatch: "跳过配置一致性检查",
    };

    let paneEl = $state<HTMLDivElement | undefined>();
    let timelineEl = $state<HTMLDivElement | undefined>();
    let timelineScrollKey = $state("");
    let timelineStickToBottom = $state(true);
    let draft = $state("");
    let cardKey = $state("");
    let notice = $state("");
    let activating = $state(false);
    let rechargeKey = $state("");
    let recharging = $state(false);
    let confirmDeactivate = $state(false);
    let mobileSidebarOpen = $state(false);
    let selectedTaskId = $state<string | null>(null);
    let sidebarPanel = $state<"recharge" | "debug" | "cloud" | null>(null);
    let debugNotice = $state("");
    let restoreTarget = $state<string | null>(null);
    let restoreOverwrite = $state(false);
    let dismissedSuggestions = $state<string[]>([]);
    let dismissedSnippets = $state<string[]>([]);
    let applyingSuggestionId = $state<string | null>(null);
    let applyingSnippet = $state(false);
    const currentPluginVersion = typeof MANIFEST_VERSION === "string" ? MANIFEST_VERSION : "dev";

    let activated = $derived($agentState.activated);
    let planLabel = $derived(PLAN_LABEL[$agentState.plan] ?? "基础版");
    let expireText = $derived($agentState.expireAt ? new Date($agentState.expireAt).toLocaleDateString("zh-CN") : "—");
    let syncBadgeLabel = $derived($agentState.syncState.enabled ? (SYNC_STATUS_LABEL[$agentState.syncState.status] ?? "同步未知") : "同步未启用");
    let syncBadgeTitle = $derived([
        $agentState.syncState.enabled ? `Vault ${$agentState.syncState.vault_name ?? "—"}` : "同步未启用",
        `状态 ${SYNC_STATUS_LABEL[$agentState.syncState.status] ?? "同步未知"}`,
        $agentState.syncState.last_error_hint ? `错误 ${$agentState.syncState.last_error_hint}` : null,
    ].filter(Boolean).join(" · "));
    // The store prepends new tasks for instant feedback; the conversation itself
    // follows the ChatGPT convention: oldest message first, newest at the bottom.
    let sortedTasks = $derived([...$tasks].sort((a, b) => a.createdAt - b.createdAt));
    let selectedTask = $derived(selectedTaskId ? sortedTasks.find((task) => task.taskId === selectedTaskId) : null);
    let displayedTasks = $derived(selectedTask ? [selectedTask] : sortedTasks);
    let displayedMessages = $derived(buildConversationMessages(displayedTasks));
    let runningCount = $derived($tasks.filter((task) => task.status === "queued" || task.status === "running" || task.status === "awaiting_confirmation").length);
    let finishedCount = $derived($tasks.filter((task) => ["done", "failed", "conflict", "interrupted", "failed_zero_cost", "delivery_failed", "cancelled"].includes(task.status)).length);
    let suggestions = $derived($tasks.filter((task) => task.settingsPatch && Object.keys(task.settingsPatch).length > 0 && !dismissedSuggestions.includes(task.taskId)));
    let themeSnippet = $derived($tasks.find((task) => task.themeSnippet?.name && !dismissedSnippets.includes(task.taskId))?.themeSnippet ?? null);
    let themeSnippetTaskId = $derived($tasks.find((task) => task.themeSnippet?.name && !dismissedSnippets.includes(task.taskId))?.taskId ?? null);

    function diagnosticText(): string {
        const node = paneEl;
        return buildAppearanceDiagnostics({
            pluginVersion: currentPluginVersion,
            obsidianVersion: (window as unknown as { app?: { appVersion?: string } }).app?.appVersion ?? "unknown",
            platform: /android/i.test(navigator.userAgent) ? "android" : /iphone|ipad/i.test(navigator.userAgent) ? "ios" : "desktop",
            viewport: { width: Math.round(window.innerWidth), height: Math.round(window.innerHeight) },
            theme: document.body.classList.contains("theme-dark") ? "dark" : "light",
            appearanceVersion: 1, backgroundEnabled: false, backgroundType: "theme", backgroundExists: true,
            safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
            overflow: { taskList: !!node && node.scrollWidth > node.clientWidth, composer: false }, lastErrorCode: null,
        });
    }
    async function copyDiagnostics() {
        try { await navigator.clipboard.writeText(diagnosticText()); debugNotice = "诊断信息已复制（已脱敏）"; }
        catch { debugNotice = "复制失败，请检查系统剪贴板权限"; }
    }
    async function copyOsyCLogs() {
        try { await navigator.clipboard.writeText(osycLogger.report()); debugNotice = "OsyC 日志已复制"; }
        catch { debugNotice = "复制失败，请从命令面板打开 OsyC 日志"; }
    }
    function closeSidebar() { mobileSidebarOpen = false; }
    function openPanel(panel: typeof sidebarPanel) { sidebarPanel = sidebarPanel === panel ? null : panel; }
    function chooseTask(taskId: string) { selectedTaskId = taskId; closeSidebar(); }
    function showAllTasks() { selectedTaskId = null; closeSidebar(); }
    function submit() {
        const message = draft.trim();
        if (!message) return;
        onSend(message); draft = ""; selectedTaskId = null;
    }
    function onKeydown(event: KeyboardEvent) {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submit(); }
    }
    function useQuick(command: string) { draft = command; }
    async function activate() {
        const key = cardKey.trim();
        if (!key) return;
        activating = true; notice = "";
        try { const result = await onActivate(key); notice = result.message; if (result.ok) { cardKey = ""; onLoadCloudVault(); } }
        finally { activating = false; }
    }
    async function doRecharge() {
        const key = rechargeKey.trim();
        if (!key) return;
        recharging = true; notice = "";
        try { const result = await onRecharge(key); notice = result.message; if (result.ok) rechargeKey = ""; }
        finally { recharging = false; }
    }
    async function applySuggestion(taskId: string) {
        const task = $tasks.find((item) => item.taskId === taskId);
        if (!task?.settingsPatch) return;
        applyingSuggestionId = taskId;
        try { const result = await onApplySettingsPatch(task.settingsPatch); notice = result.applied > 0 ? `已应用 ${result.applied} 项同步设置调整` : result.rejected.map((item) => item.reason).join("；"); }
        catch (error) { osycLogger.error("应用同步设置建议失败", error); notice = "应用设置建议失败"; }
        finally { applyingSuggestionId = null; dismissedSuggestions = [...dismissedSuggestions, taskId]; }
    }
    function dismissSuggestion(taskId: string) { dismissedSuggestions = [...dismissedSuggestions, taskId]; }
    function suggestionText(task: AITask): string {
        return Object.entries(task.settingsPatch ?? {}).map(([key, value]) => `${SETTING_LABELS[key] ?? key}：${typeof value === "boolean" ? (value ? "开启" : "关闭") : String(value)}`).join("、");
    }
    async function applyThemeSnippet() {
        if (!themeSnippet) return;
        applyingSnippet = true;
        try { const result = await onApplyThemeSnippet(themeSnippet); notice = result.message; }
        catch (error) { osycLogger.error("应用主题片段失败", error); notice = "应用主题片段失败"; }
        finally { applyingSnippet = false; if (themeSnippetTaskId) dismissedSnippets = [...dismissedSnippets, themeSnippetTaskId]; }
    }
    function beginRestore(snapshotId: string) { restoreTarget = snapshotId; restoreOverwrite = false; }
    async function confirmRestore() {
        if (!restoreTarget) return;
        const snapshotId = restoreTarget; restoreTarget = null; await onCloudRestore(snapshotId, restoreOverwrite);
    }

    function onTimelineScroll() {
        if (!timelineEl) return;
        timelineStickToBottom = shouldFollowTimeline(timelineEl);
    }

    onMount(() => {
        if (activated) onLoadCloudVault();
    });

    // Keep scrolling local to the chat timeline. The host workspace and note view
    // are never resized or scrolled when a task arrives.
    $effect(() => {
        const newest = displayedTasks[displayedTasks.length - 1];
        const key = `${selectedTaskId ?? "all"}:${displayedTasks.length}:${newest?.taskId ?? ""}:${newest?.responseText?.length ?? 0}:${newest?.progressEvents?.length ?? 0}`;
        if (!timelineEl || !newest || key === timelineScrollKey) return;
        timelineScrollKey = key;
        queueMicrotask(() => {
            if (timelineEl && timelineStickToBottom) timelineEl.scrollTop = timelineEl.scrollHeight;
        });
    });
</script>

<div class="ai-pane osyc-ai-agent" bind:this={paneEl}>
    <div class:ai-sidebar-open={mobileSidebarOpen} class="ai-shell">
        <aside class="ai-sidebar" aria-label="会话记录">
            <div class="ai-sidebar-head"><button class="ai-icon-btn ai-mobile-close" aria-label="关闭会话记录" onclick={closeSidebar}>×</button><button class="ai-new-chat" onclick={showAllTasks} aria-label="新建会话"><span aria-hidden="true">＋</span><span>新会话</span></button></div>
            <div class="ai-session-heading"><span>会话记录</span><span class="ai-session-count">{$tasks.length}</span></div>
            <nav class="ai-session-list">
                <button class:active={selectedTaskId === null} class="ai-session-item" onclick={showAllTasks}><span class="ai-session-icon" aria-hidden="true">⌂</span><span class="ai-session-label">全部会话</span></button>
                {#each $tasks as task}<button class:active={selectedTaskId === task.taskId} class="ai-session-item" onclick={() => chooseTask(task.taskId)}><span class="ai-session-icon ai-session-status-{task.status}" aria-hidden="true"></span><span class="ai-session-copy"><span class="ai-session-label">{task.message}</span><span class="ai-session-time">{new Date(task.createdAt).toLocaleDateString("zh-CN")}</span></span></button>{/each}
                {#if sortedTasks.length === 0}<div class="ai-session-empty">还没有会话</div>{/if}
            </nav>
            <div class="ai-sidebar-actions">
                <button class="ai-sidebar-action" data-sidebar-action="settings" onclick={() => { onOpenSettings(); closeSidebar(); }}><span aria-hidden="true">⚙</span><span>设置</span></button>
                <button class="ai-sidebar-action" data-sidebar-action="account" onclick={() => { onOpenAccount(); closeSidebar(); }}><span aria-hidden="true">◇</span><span>权益</span></button>
                {#if activated}<button class="ai-sidebar-action" data-sidebar-action="recharge" class:active={sidebarPanel === "recharge"} onclick={() => openPanel("recharge")}><span aria-hidden="true">＋</span><span>充值</span></button>{/if}
                <button class="ai-sidebar-action" data-sidebar-action="debug" title="外观与调试" class:active={sidebarPanel === "debug"} onclick={() => openPanel("debug")}><span aria-hidden="true">⌘</span><span>调试</span></button>
                {#if activated && ($agentState.plan === "member" || $agentState.plan === "pro") && $agentState.cloudVault.available}<button class="ai-sidebar-action" class:active={sidebarPanel === "cloud"} onclick={() => openPanel("cloud")}><span aria-hidden="true">▣</span><span>私有备份</span></button>{/if}
                {#if finishedCount > 0}<button class="ai-sidebar-action" onclick={onClear}><span aria-hidden="true">⌫</span><span>清理记录</span></button>{/if}
                {#if activated}<button class="ai-sidebar-action ai-sidebar-danger" onclick={() => (confirmDeactivate = true)}><span aria-hidden="true">⎋</span><span>退出账户</span></button>{/if}
            </div>
        </aside>

        <main class="ai-chat">
            <header class="ai-chat-header"><button class="ai-icon-btn ai-mobile-menu" aria-label="打开会话记录" onclick={() => (mobileSidebarOpen = true)}>☰</button><div class="ai-chat-title"><strong>OC</strong><span>Obsidian 笔记助理</span></div><div class="ai-account-strip" aria-label="账户状态"><span><b>{activated ? $agentState.credits : "—"}</b> 积分</span><span>到期 {expireText}</span><span class="ai-plan-badge" data-plan={$agentState.plan}>{planLabel}</span>{#if $agentState.syncState.enabled || $agentState.syncState.status !== "unknown"}<span class="ai-sync-badge" data-sync-status={$agentState.syncState.status} title={syncBadgeTitle}>{syncBadgeLabel}</span>{/if}</div></header>
            {#if isMock}<div class="ai-banner"><span class="ai-banner-dot"></span>演示模式 · 当前为本地模拟，任务与积分不会真实消耗</div>{/if}
            {#if sidebarPanel === "recharge"}<section class="ai-inline-panel" aria-label="充值"><input class="ai-field" type="text" placeholder="输入卡密" bind:value={rechargeKey} disabled={recharging} /><div class="ai-panel-actions"><span class="ai-hint">充值后积分和有效期会同步更新</span><button class="ai-btn ai-btn-primary" disabled={recharging || !rechargeKey.trim()} onclick={doRecharge}>{recharging ? "处理中…" : "确认充值"}</button></div>{#if notice}<div class="ai-notice">{notice}</div>{/if}</section>{:else if sidebarPanel === "debug"}<section class="ai-inline-panel" aria-label="OsyC 调试信息"><div class="ai-panel-title">调试覆盖层</div><div class="ai-debug-grid"><span>viewport</span><strong>{Math.round(window.innerWidth)} × {Math.round(window.innerHeight)}</strong><span>主题</span><strong>{document.body.classList.contains("theme-dark") ? "深色" : "浅色"}</strong><span>进行中</span><strong>{runningCount}</strong></div><button class="ai-text-btn" onclick={copyDiagnostics}>复制脱敏诊断</button><button class="ai-text-btn" onclick={copyOsyCLogs}>复制 OsyC 日志</button>{#if debugNotice}<div class="ai-hint">{debugNotice}</div>{/if}</section>{:else if sidebarPanel === "cloud" && activated}<section class="ai-inline-panel" aria-label="私有备份"><div class="ai-panel-title">Cloud-Vault 私有备份</div><button class="ai-btn ai-btn-primary" disabled={$agentState.cloudVault.busy || !$agentState.cloudVault.available} onclick={() => onCloudBackup()}>{$agentState.cloudVault.busy ? "备份中…" : "立即备份"}</button>{#if !$agentState.cloudVault.available}<div class="ai-hint">{$agentState.cloudVault.reason || "当前不可用"}</div>{:else if $agentState.cloudVault.snapshots.length === 0}<div class="ai-hint">还没有备份快照</div>{:else}<div class="ai-cloud-list">{#each $agentState.cloudVault.snapshots as snapshot}<div class="ai-cloud-row"><span>{new Date(snapshot.created_at * 1000).toLocaleString("zh-CN")} · {snapshot.note_count} 篇</span><button class="ai-text-btn" disabled={$agentState.cloudVault.busy} onclick={() => beginRestore(snapshot.snapshot_id)}>恢复</button></div>{/each}</div>{/if}{#if restoreTarget}<div class="ai-confirm-panel"><strong>确认恢复快照？</strong><label><input type="checkbox" bind:checked={restoreOverwrite} /> 覆盖同名笔记</label><div class="ai-panel-actions"><button class="ai-btn" onclick={() => (restoreTarget = null)}>取消</button><button class="ai-btn ai-btn-primary" onclick={confirmRestore}>确认</button></div></div>{/if}{#if $agentState.cloudVault.message}<div class="ai-notice">{$agentState.cloudVault.message}</div>{/if}</section>{/if}
            <div class="ai-chat-timeline" bind:this={timelineEl} onscroll={onTimelineScroll}>
                {#if !$agentState.onboarded}<section class="ai-welcome"><h1>和 OC 开始对话</h1><p>阅读、整理和归纳你的 Obsidian 笔记，并把结果交付回笔记库。</p><button class="ai-btn ai-btn-primary" onclick={onMarkOnboarded}>开始使用</button></section>{/if}
                {#if !activated}<section class="ai-activation"><div class="ai-onboard-icon" aria-hidden="true">✦</div><h2>输入卡密，开启 OC</h2><p>激活后即可在手机上使用 OC 整理笔记。</p><input class="ai-field" type="text" placeholder="请输入卡密" bind:value={cardKey} disabled={activating} /><button class="ai-btn ai-btn-primary" disabled={activating || !cardKey.trim()} onclick={activate}>{activating ? "激活中…" : "激活"}</button>{#if notice}<div class="ai-notice">{notice}</div>{/if}</section>{:else if displayedTasks.length === 0}<section class="ai-welcome ai-welcome-empty"><div class="ai-welcome-mark" aria-hidden="true">OC</div><h1>今天想整理什么？</h1><p>选择一个起点，或直接告诉 OC 你的目标。</p><div class="ai-quick-list">{#each QUICK_COMMANDS as command}<button class="ai-quick-chip" onclick={() => useQuick(command)}>{command}</button>{/each}</div></section>{:else}{#each displayedMessages as message (message.id)}<article class="ai-conversation" data-message-id={message.id}>{#if message.role === "user"}<div class="ai-message ai-message-user"><div class="ai-message-role">你</div><div class="ai-message-body ai-rich-content">{message.text}</div></div>{:else}<div class="ai-message ai-message-assistant"><AIAgentAssistantMessage {app} task={message.task} {onOpenFile} {onRetryPush} {onConfirmTask} {onCancelConfirmation} /></div>{/if}</article>{/each}{/if}
                {#if suggestions.length > 0}{#each suggestions as suggestion}<div class="ai-suggestion"><span>同步设置建议：{suggestionText(suggestion)}</span><div><button class="ai-text-btn" disabled={applyingSuggestionId !== null} onclick={() => applySuggestion(suggestion.taskId)}>{applyingSuggestionId === suggestion.taskId ? "应用中…" : "应用"}</button><button class="ai-text-btn" onclick={() => dismissSuggestion(suggestion.taskId)}>忽略</button></div></div>{/each}{/if}
                {#if themeSnippet}<div class="ai-suggestion"><span>建议应用主题片段「{themeSnippet.name}」</span><div><button class="ai-text-btn" disabled={applyingSnippet} onclick={applyThemeSnippet}>{applyingSnippet ? "应用中…" : "应用"}</button><button class="ai-text-btn" onclick={() => themeSnippetTaskId && (dismissedSnippets = [...dismissedSnippets, themeSnippetTaskId])}>忽略</button></div></div>{/if}
            </div>
            {#if activated}<section class="ai-composer"><textarea class="ai-field ai-field-area" rows="1" placeholder="给 OC 发消息…" bind:value={draft} onkeydown={onKeydown}></textarea><div class="ai-composer-foot"><span class="ai-hint">Ctrl / ⌘ + Enter 发送</span><button class="ai-send-btn" aria-label="发送" disabled={!draft.trim()} onclick={submit}><span aria-hidden="true">↑</span></button></div></section>{/if}
        </main>
    </div>
    {#if confirmDeactivate}<div class="ai-confirm-panel ai-confirm-floating"><strong>退出当前账户？</strong><p>本机将退出登录，服务器端记录保留。</p><div class="ai-panel-actions"><button class="ai-btn" onclick={() => (confirmDeactivate = false)}>取消</button><button class="ai-btn ai-btn-danger" onclick={() => { confirmDeactivate = false; onDeactivate(); }}>确认退出</button></div></div>{/if}
</div>

<style>
    .ai-pane { height: 100%; max-height: 100%; min-height: 0; min-width: 0; overflow: hidden; box-sizing: border-box; color: var(--osyc-ai-text, var(--text-normal)); background: var(--osyc-ai-background-color, var(--background-primary)); }
    .ai-shell { display: grid; grid-template-columns: minmax(210px, 26%) minmax(0, 1fr); height: 100%; min-height: 0; background: var(--background-primary); background-color: var(--osyc-ai-surface-alt, var(--background-secondary)); }
    .ai-sidebar { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 12px 10px; border-right: 1px solid var(--background-modifier-border); background: var(--background-secondary); }
    .ai-sidebar-head { display: flex; align-items: center; gap: 8px; margin-bottom: 18px; }
    .ai-new-chat { flex: 1; min-height: 40px; display: flex; align-items: center; gap: 8px; border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 0 12px; color: var(--text-normal); background: var(--background-primary); cursor: pointer; }
    .ai-new-chat:hover, .ai-session-item:hover, .ai-sidebar-action:hover { background: var(--background-modifier-hover); }
    .ai-session-heading { display: flex; justify-content: space-between; padding: 0 8px 8px; font-size: var(--font-ui-smaller); color: var(--text-muted); }
    .ai-session-count { color: var(--text-faint); }
    .ai-session-list { flex: 1 1 0; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
    .ai-session-item { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 42px; border: 0; border-radius: 6px; padding: 6px 8px; text-align: left; color: var(--text-normal); background: transparent; cursor: pointer; }
    .ai-session-item.active { background: var(--background-modifier-hover); color: var(--text-accent); }
    .ai-session-icon { flex: 0 0 auto; width: 16px; height: 16px; display: inline-grid; place-items: center; color: var(--text-muted); }
    .ai-session-status-queued, .ai-session-status-running, .ai-session-status-done, .ai-session-status-failed { border-radius: 50%; width: 7px; height: 7px; margin: 0 4px; background: var(--text-faint); }
    .ai-session-status-running { background: var(--interactive-accent); }
    .ai-session-status-done { background: var(--color-green); }
    .ai-session-status-failed { background: var(--color-red); }
    .ai-session-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .ai-session-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--font-ui-small); }
    .ai-session-time { color: var(--text-faint); font-size: var(--font-ui-smaller); }
    .ai-session-empty { padding: 12px 8px; color: var(--text-faint); font-size: var(--font-ui-smaller); }
    .ai-sidebar-actions { display: flex; flex-direction: column; gap: 2px; padding-top: 10px; border-top: 1px solid var(--background-modifier-border); }
    .ai-sidebar-action { display: flex; align-items: center; gap: 10px; min-height: 40px; border: 0; border-radius: 6px; padding: 0 8px; text-align: left; color: var(--text-muted); background: transparent; cursor: pointer; }
    .ai-sidebar-action.active { color: var(--text-accent); background: var(--background-modifier-hover); }
    .ai-sidebar-danger { color: var(--text-error); }
    .ai-chat { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; background: var(--background-primary); }
    .ai-chat-header { display: flex; align-items: center; gap: 10px; min-height: 52px; padding: 8px 18px; border-bottom: 1px solid var(--background-modifier-border); }
    .ai-chat-title { display: flex; flex-direction: column; min-width: 0; line-height: 1.2; }
    .ai-chat-title strong { font-family: var(--osyc-ai-heading-font-family, var(--font-interface)); font-size: var(--font-ui-medium); color: var(--text-normal); }
    .ai-chat-title span { color: var(--text-muted); font-size: var(--font-ui-smaller); }
    .ai-account-strip { display: flex; align-items: center; gap: 12px; margin-left: auto; color: var(--text-muted); font-size: var(--font-ui-smaller); white-space: nowrap; }
    .ai-account-strip b { color: var(--text-normal); }
    .ai-plan-badge { display: inline-flex; align-items: center; min-height: 22px; border-radius: 5px; padding: 0 7px; color: var(--text-on-accent); background: var(--text-faint); font-weight: 600; }
    .ai-plan-badge[data-plan="member"] { background: var(--interactive-accent); }
    .ai-plan-badge[data-plan="pro"] { background: var(--interactive-accent); }
    .ai-sync-badge { display: inline-flex; align-items: center; min-height: 22px; border-radius: 999px; padding: 0 8px; color: var(--text-on-accent); background: var(--color-green); font-size: var(--font-ui-smaller); font-weight: 700; }
    .ai-sync-badge[data-sync-status="degraded"] { background: var(--color-orange); }
    .ai-sync-badge[data-sync-status="failed"] { background: var(--text-error); }
    .ai-sync-badge[data-sync-status="unknown"] { background: var(--text-faint); }
    .ai-chat-timeline, .ai-task-list { flex: 1 1 0; min-height: 0; overflow-y: auto; padding: 24px clamp(14px, 8vw, 100px); overscroll-behavior: contain; }
    .ai-conversation { display: flex; flex-direction: column; gap: 18px; max-width: 800px; margin: 0 auto 30px; }
    .ai-message { display: flex; gap: 12px; min-width: 0; }
    .ai-message-user { justify-content: flex-end; }
    .ai-message-user .ai-message-body { max-width: min(78%, 620px); padding: 10px 14px; border-radius: 14px 14px 4px 14px; color: var(--text-on-accent); background: var(--interactive-accent); white-space: pre-wrap; overflow-wrap: anywhere; }
    .ai-message-role { flex: 0 0 auto; display: flex; align-items: flex-start; gap: 6px; padding-top: 3px; color: var(--text-muted); font-size: var(--font-ui-smaller); }
    .ai-message-user .ai-message-role { order: 2; }
    .ai-message-assistant { align-items: flex-start; }
    .ai-oc-avatar { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 5px; color: var(--text-on-accent); background: var(--interactive-accent); font-size: 10px; font-weight: 700; }
    .ai-welcome, .ai-activation { display: flex; flex-direction: column; align-items: center; max-width: 560px; margin: 12vh auto 0; text-align: center; color: var(--text-muted); }
    .ai-welcome h1, .ai-activation h2 { margin: 0 0 8px; color: var(--text-normal); font-size: clamp(1.4rem, 3vw, 2rem); }
    .ai-welcome p, .ai-activation p { margin: 0 0 20px; line-height: 1.6; }
    .ai-welcome-mark { display: grid; place-items: center; width: 46px; height: 46px; margin-bottom: 18px; border-radius: 12px; color: var(--text-on-accent); background: var(--interactive-accent); font-weight: 700; }
    .ai-welcome-empty { margin-top: 10vh; }
    .ai-activation { gap: 10px; width: min(100%, 360px); }
    .ai-activation .ai-field { width: 100%; }
    .ai-quick-list { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; max-width: 680px; }
    .ai-quick-chip { min-height: 38px; border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 7px 12px; color: var(--text-muted); background: var(--background-secondary); cursor: pointer; }
    .ai-quick-chip:hover { color: var(--text-normal); border-color: var(--interactive-accent); }
    .ai-composer { flex: 0 0 auto; flex-shrink: 0; display: flex; flex-direction: column; gap: 6px; padding: 10px clamp(14px, 8vw, 100px) max(10px, env(safe-area-inset-bottom)); background: var(--background-primary); }
    .ai-field { box-sizing: border-box; width: 100%; border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 10px 12px; color: var(--text-normal); background: var(--background-primary-alt); font: inherit; }
    .ai-field:focus { outline: none; border-color: var(--interactive-accent); }
    .ai-field-area { min-height: 44px; max-height: 180px; resize: vertical; line-height: 1.45; }
    .ai-composer-foot, .ai-panel-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .ai-send-btn, .ai-icon-btn { display: inline-grid; place-items: center; width: 40px; height: 40px; border: 1px solid var(--background-modifier-border); border-radius: 7px; color: var(--text-on-accent); background: var(--interactive-accent); cursor: pointer; }
    .ai-send-btn:disabled { opacity: .45; cursor: default; }
    .ai-icon-btn { flex: 0 0 auto; color: var(--text-muted); background: transparent; }
    .ai-mobile-menu, .ai-mobile-close { display: none; }
    .ai-hint, .ai-notice { color: var(--text-muted); font-size: var(--font-ui-smaller); }
    .ai-banner, .ai-suggestion, .ai-inline-panel { max-width: 800px; margin: 8px auto; }
    .ai-banner { display: flex; align-items: center; gap: 7px; padding: 7px 12px; color: var(--text-normal); background: var(--background-modifier-warning); font-size: var(--font-ui-smaller); }
    .ai-banner-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-warning); }
    .ai-suggestion, .ai-inline-panel { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--background-modifier-border); border-radius: 8px; color: var(--text-muted); background: var(--background-secondary); font-size: var(--font-ui-smaller); }
    .ai-suggestion { flex-direction: row; align-items: center; justify-content: space-between; }
    .ai-suggestion > div { display: flex; gap: 8px; }
    .ai-panel-title { color: var(--text-normal); font-weight: 600; }
    .ai-debug-grid { display: grid; grid-template-columns: auto 1fr; gap: 5px 12px; }
    .ai-debug-grid strong { color: var(--text-normal); font-weight: 500; }
    .ai-text-btn, .ai-btn { min-height: 34px; border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 6px 11px; color: var(--text-normal); background: var(--background-primary); cursor: pointer; }
    .ai-text-btn { border: 0; padding-inline: 2px; color: var(--text-accent); background: transparent; }
    .ai-btn-primary { color: var(--text-on-accent); border-color: var(--interactive-accent); background: var(--interactive-accent); }
    .ai-btn-danger { color: var(--text-on-accent); border-color: var(--text-error); background: var(--text-error); }
    .ai-cloud-list { display: flex; flex-direction: column; gap: 4px; }
    .ai-cloud-row { display: flex; justify-content: space-between; gap: 8px; padding: 6px 8px; background: var(--background-primary-alt); }
    .ai-confirm-panel { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid var(--background-modifier-border); border-radius: 8px; background: var(--background-secondary); }
    .ai-confirm-floating { position: absolute; z-index: 3; inset: 50% auto auto 50%; transform: translate(-50%, -50%); width: min(90%, 360px); box-shadow: var(--shadow-l); }
    .ai-confirm-panel p { margin: 0; color: var(--text-muted); font-size: var(--font-ui-smaller); }
    @media (max-width: 720px) {
        .ai-pane { height: 100%; padding-bottom: max(8px, env(safe-area-inset-bottom)); }
        .ai-shell { display: block; position: relative; }
        .ai-chat { height: 100%; }
        .ai-sidebar { position: absolute; z-index: 2; inset: 0 auto 0 0; width: min(86vw, 320px); transform: translateX(-102%); transition: transform .18s ease; box-shadow: var(--shadow-l); }
        .ai-sidebar-open .ai-sidebar { transform: translateX(0); }
        .ai-mobile-menu, .ai-mobile-close { display: inline-grid; }
        .ai-chat-header { padding-inline: 10px; }
        .ai-account-strip { gap: 6px; font-size: 11px; }
        .ai-account-strip span:nth-child(2) { display: none; }
        .ai-sync-badge { display: none; }
        .ai-chat-timeline { padding: 18px 12px; }
        .ai-composer { padding-inline: 12px; }
        .ai-message-user .ai-message-body { max-width: 84%; }
        .ai-banner, .ai-suggestion, .ai-inline-panel { margin-inline: 12px; }
    }
</style>
