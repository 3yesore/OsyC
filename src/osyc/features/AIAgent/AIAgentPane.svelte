<script module lang="ts">
    declare const MANIFEST_VERSION: string | undefined;
</script>

<script lang="ts">
    import { onMount } from "svelte";
    import type { App } from "@/deps.ts";
    import type { Writable } from "svelte/store";
    import type { AISnippet, AITask, AIAgentState } from "./CmdAIAgent";
    import AIAgentAssistantMessage from "./AIAgentAssistantMessage.svelte";
    import OsycIcon from "./OsycIcon.svelte";
    import { buildConversationMessages, shouldFollowTimeline } from "./conversationModel";
    import { groupSessionsByRecency } from "./sessionList";
    import {
        loadOsycPaneBooleanPreference,
        saveOsycPaneBooleanPreference,
        OSYC_PANE_PREFERENCE_KEYS,
    } from "./osycPanePreferences";
    import { osycLogger } from "@/osyc/serviceFeatures/osycLogger";
    import type { Announcement } from "./announcements";

    interface Props {
        app: App;
        tasks: Writable<AITask[]>;
        agentState: Writable<AIAgentState>;
        isMock: boolean;
        onSend: (message: string) => void;
        onActivate: (cardKey: string) => Promise<{ ok: boolean; message: string }>;
        onClear: () => void;
        onOpenFile: (path: string) => void;
        onDeactivate: () => void;
        onOpenTools: () => void;
        onLoadCloudVault: () => void;
        onRetryPush: (taskId: string) => void;
        onConfirmTask: (taskId: string) => Promise<{ ok: boolean; message: string }>;
        onCancelConfirmation: (taskId: string) => Promise<{ ok: boolean; message: string }>;
        onUploadDiagnostics: (task: AITask) => Promise<{ ok: boolean; message: string }>;
        announcements: Writable<Announcement[]>;
        onOpenAnnouncements: () => void;
        onOpenAccount: () => void;
        onApplySettingsPatch: (patch: Record<string, unknown>) => Promise<{ applied: number; rejected: { key: string; reason: string }[] }>;
        onApplyThemeSnippet: (snippet: AISnippet) => Promise<{ ok: boolean; message: string }>;
        onMarkOnboarded: () => void;
    }

    let {
        app, tasks, agentState, isMock, onSend, onActivate, onClear, onOpenFile,
        onDeactivate, onOpenTools,
        onLoadCloudVault, onRetryPush, onConfirmTask, onCancelConfirmation, onApplySettingsPatch,
        onApplyThemeSnippet, onMarkOnboarded, onUploadDiagnostics, announcements, onOpenAnnouncements,
        onOpenAccount,
    }: Props = $props();

    const QUICK_COMMANDS = [
        { icon: "file-text", text: "整理本周新增笔记，生成一份摘要" },
        { icon: "list", text: "把散落的待办汇总成一个清单" },
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
    // One icon per lifecycle state so the session list stays scannable without
    // relying on colour alone. Names are Obsidian built-ins.
    const SESSION_STATUS_ICON: Record<string, string> = {
        queued: "clock",
        running: "loader",
        done: "check",
        failed: "alert-triangle",
        awaiting_confirmation: "info",
        conflict: "alert-triangle",
        interrupted: "pause",
        failed_zero_cost: "x",
        delivery_failed: "alert-triangle",
        cancelled: "x",
    };
    /** Ceiling for the auto-growing composer, matching its max-height. */
    const COMPOSER_MAX_HEIGHT = 180;

    let paneEl = $state<HTMLDivElement | undefined>();
    let timelineEl = $state<HTMLDivElement | undefined>();
    let composerEl = $state<HTMLTextAreaElement | undefined>();
    let timelineScrollKey = $state("");
    let timelineStickToBottom = $state(true);
    let draft = $state("");
    let cardKey = $state("");
    let notice = $state("");
    let activating = $state(false);
    let confirmDeactivate = $state(false);
    let mobileSidebarOpen = $state(false);
    let sidebarCollapsed = $state(false);
    let selectedTaskId = $state<string | null>(null);
    let unreadAnnouncements = $derived($announcements.length);
    let dismissedSuggestions = $state<string[]>([]);
    let dismissedSnippets = $state<string[]>([]);
    let applyingSuggestionId = $state<string | null>(null);
    let applyingSnippet = $state(false);

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
    // The session list is the opposite: newest conversation first, with a date
    // heading per recency bucket.
    let sessionGroups = $derived(groupSessionsByRecency($tasks));
    let selectedTask = $derived(selectedTaskId ? sortedTasks.find((task) => task.taskId === selectedTaskId) : null);
    let displayedTasks = $derived(selectedTask ? [selectedTask] : sortedTasks);
    let displayedMessages = $derived(buildConversationMessages(displayedTasks));
    let finishedCount = $derived($tasks.filter((task) => ["done", "failed", "conflict", "interrupted", "failed_zero_cost", "delivery_failed", "cancelled"].includes(task.status)).length);
    let suggestions = $derived($tasks.filter((task) => task.settingsPatch && Object.keys(task.settingsPatch).length > 0 && !dismissedSuggestions.includes(task.taskId)));
    let themeSnippet = $derived($tasks.find((task) => task.themeSnippet?.name && !dismissedSnippets.includes(task.taskId))?.themeSnippet ?? null);
    let themeSnippetTaskId = $derived($tasks.find((task) => task.themeSnippet?.name && !dismissedSnippets.includes(task.taskId))?.taskId ?? null);
    let sidebarToggleLabel = $derived(sidebarCollapsed ? "展开会话记录" : "收起会话记录");

    function closeSidebar() { mobileSidebarOpen = false; }
    function chooseTask(taskId: string) { selectedTaskId = taskId; closeSidebar(); }
    function showAllTasks() { selectedTaskId = null; closeSidebar(); }
    function sessionStatusIcon(status: string): string { return SESSION_STATUS_ICON[status] ?? "clock"; }
    function toggleSidebar() {
        sidebarCollapsed = !sidebarCollapsed;
        saveOsycPaneBooleanPreference(app, OSYC_PANE_PREFERENCE_KEYS.sidebarCollapsed, sidebarCollapsed);
    }
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

    function onTimelineScroll() {
        if (!timelineEl) return;
        timelineStickToBottom = shouldFollowTimeline(timelineEl);
    }

    onMount(() => {
        if (activated) onLoadCloudVault();
        // A per-vault layout preference, read after mount so the first paint does
        // not depend on the host storage API.
        sidebarCollapsed = loadOsycPaneBooleanPreference(app, OSYC_PANE_PREFERENCE_KEYS.sidebarCollapsed);
    });

    // ChatGPT grows the composer with the draft up to a ceiling, then scrolls.
    $effect(() => {
        const element = composerEl;
        const pending = draft;
        if (!element) return;
        if (!pending) {
            element.style.height = "";
            return;
        }
        element.style.height = "auto";
        element.style.height = `${Math.min(element.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
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
    <div
        class:ai-sidebar-collapsed={sidebarCollapsed}
        class:ai-sidebar-open={mobileSidebarOpen}
        class="ai-shell"
    >
        <aside class="ai-sidebar" aria-label="会话记录">
            <div class="ai-sidebar-head">
                <button class="ai-icon-btn ai-mobile-close" aria-label="关闭会话记录" title="关闭会话记录" onclick={closeSidebar}><OsycIcon name="x" size={18} /></button>
                <button class="ai-new-chat" onclick={showAllTasks} aria-label="新建会话" title="新建会话"><OsycIcon name="plus" size={16} /><span class="ai-control-label">新会话</span></button>
            </div>
            <nav class="ai-session-list">
                <button class:active={selectedTaskId === null} class="ai-session-item" onclick={showAllTasks} title="显示全部会话的消息"><OsycIcon name="home" size={15} /><span class="ai-session-label">全部会话</span></button>
                {#each sessionGroups as group}<div class="ai-session-group">{group.label}</div>{#each group.tasks as task}<button class:active={selectedTaskId === task.taskId} class="ai-session-item" onclick={() => chooseTask(task.taskId)} title={task.message}><span class="ai-session-status ai-session-status-{task.status}" aria-hidden="true"><OsycIcon name={sessionStatusIcon(task.status)} size={15} /></span><span class="ai-session-label">{task.message}</span></button>{/each}{/each}
                {#if sortedTasks.length === 0}<div class="ai-session-empty">还没有会话</div>{/if}
            </nav>
            <div class="ai-sidebar-actions">
                <button class="ai-sidebar-action" data-sidebar-action="tools" title="工具中心" onclick={() => { onOpenTools(); closeSidebar(); }}><OsycIcon name="wrench" size={16} /><span class="ai-control-label">工具中心</span></button>
                {#if finishedCount > 0}<button class="ai-sidebar-action" title="清理记录" onclick={onClear}><OsycIcon name="trash-2" size={16} /><span class="ai-control-label">清理记录</span></button>{/if}
                {#if activated}<button class="ai-sidebar-action ai-sidebar-danger" title="退出账户" onclick={() => (confirmDeactivate = true)}><OsycIcon name="log-out" size={16} /><span class="ai-control-label">退出账户</span></button>{/if}
            </div>
        </aside>
        {#if mobileSidebarOpen}<button class="ai-sidebar-scrim" aria-label="关闭会话记录" onclick={closeSidebar}></button>{/if}

        <main class="ai-chat">
            <header class="ai-chat-header"><button class="ai-icon-btn ai-sidebar-toggle" aria-label={sidebarToggleLabel} title={sidebarToggleLabel} onclick={toggleSidebar}><OsycIcon name="panel-left" size={18} /></button><button class="ai-icon-btn ai-mobile-menu" aria-label="打开会话记录" title="打开会话记录" onclick={() => (mobileSidebarOpen = true)}><OsycIcon name="menu" size={18} /></button><div class="ai-chat-title"><strong>OC</strong><span>Obsidian 笔记助理</span></div><button class="ai-icon-btn ai-announcement-button" aria-label="公告" title="公告" onclick={onOpenAnnouncements}><OsycIcon name="bell" size={18} />{#if unreadAnnouncements > 0}<span class="ai-icon-dot" aria-hidden="true"></span>{/if}</button><button class="ai-icon-btn ai-tools-button" aria-label="工具中心" title="工具中心" onclick={() => onOpenTools()}><OsycIcon name="wrench" size={18} /></button><button class="ai-account-strip" aria-label="我的账户与权益" title="我的账户与权益" onclick={onOpenAccount}><span><b>{activated ? $agentState.credits : "—"}</b> 积分</span><span>到期 {expireText}</span><span class="ai-plan-badge" data-plan={$agentState.plan}>{planLabel}</span>{#if $agentState.syncState.enabled || $agentState.syncState.status !== "unknown"}<span class="ai-sync-badge" data-sync-status={$agentState.syncState.status} title={syncBadgeTitle}>{syncBadgeLabel}</span>{/if}</button></header>
            {#if isMock}<div class="ai-banner"><span class="ai-banner-dot"></span>演示模式 · 当前为本地模拟，任务与积分不会真实消耗</div>{/if}
            <div class="ai-chat-timeline" bind:this={timelineEl} onscroll={onTimelineScroll}>
                {#if !$agentState.onboarded}<section class="ai-welcome"><h1>和 OC 开始对话</h1><p>阅读、整理和归纳你的 Obsidian 笔记，并把结果交付回笔记库。</p><button class="ai-btn ai-btn-primary" onclick={onMarkOnboarded}>开始使用</button></section>{/if}
                {#if !activated}<section class="ai-activation"><span class="ai-onboard-icon" aria-hidden="true"><OsycIcon name="sparkles" size={26} /></span><h2>输入卡密，开启 OC</h2><p>激活后即可在手机上使用 OC 整理笔记。</p><input class="ai-field" type="text" placeholder="请输入卡密" bind:value={cardKey} disabled={activating} /><button class="ai-btn ai-btn-primary" disabled={activating || !cardKey.trim()} onclick={activate}>{activating ? "激活中…" : "激活"}</button>{#if notice}<div class="ai-notice">{notice}</div>{/if}</section>{:else if displayedTasks.length === 0}<section class="ai-welcome ai-welcome-empty"><div class="ai-welcome-mark" aria-hidden="true">OC</div><h1>今天想整理什么？</h1><p>选择一个起点，或直接告诉 OC 你的目标。</p><div class="ai-quick-list">{#each QUICK_COMMANDS as command}<button class="ai-quick-chip" onclick={() => useQuick(command.text)}><OsycIcon name={command.icon} size={15} /><span>{command.text}</span></button>{/each}</div></section>{:else}{#each displayedMessages as message (message.id)}<article class="ai-conversation" data-message-id={message.id}>{#if message.role === "user"}<div class="ai-message ai-message-user"><div class="ai-message-body ai-rich-content">{message.text}</div></div>{:else}<div class="ai-message ai-message-assistant"><AIAgentAssistantMessage {app} task={message.task} {onOpenFile} {onRetryPush} {onConfirmTask} {onCancelConfirmation} {onUploadDiagnostics} /></div>{/if}</article>{/each}{/if}
                {#if suggestions.length > 0}{#each suggestions as suggestion}<div class="ai-suggestion"><span>同步设置建议：{suggestionText(suggestion)}</span><div><button class="ai-text-btn" disabled={applyingSuggestionId !== null} onclick={() => applySuggestion(suggestion.taskId)}>{applyingSuggestionId === suggestion.taskId ? "应用中…" : "应用"}</button><button class="ai-text-btn" onclick={() => dismissSuggestion(suggestion.taskId)}>忽略</button></div></div>{/each}{/if}
                {#if themeSnippet}<div class="ai-suggestion"><span>建议应用主题片段「{themeSnippet.name}」</span><div><button class="ai-text-btn" disabled={applyingSnippet} onclick={applyThemeSnippet}>{applyingSnippet ? "应用中…" : "应用"}</button><button class="ai-text-btn" onclick={() => themeSnippetTaskId && (dismissedSnippets = [...dismissedSnippets, themeSnippetTaskId])}>忽略</button></div></div>{/if}
            </div>
            {#if activated}<section class="ai-composer"><div class="ai-composer-box"><textarea bind:this={composerEl} class="ai-composer-input" rows="1" placeholder="给 OC 发消息…" bind:value={draft} onkeydown={onKeydown}></textarea><div class="ai-composer-foot"><span class="ai-hint">Ctrl / ⌘ + Enter 发送</span><button class="ai-send-btn" aria-label="发送" title="发送" disabled={!draft.trim()} onclick={submit}><OsycIcon name="arrow-up" size={18} /></button></div></div></section>{/if}
        </main>
    </div>
    {#if confirmDeactivate}<div class="ai-confirm-panel ai-confirm-floating"><strong>退出当前账户？</strong><p>本机将退出登录，服务器端记录保留。</p><div class="ai-panel-actions"><button class="ai-btn" onclick={() => (confirmDeactivate = false)}>取消</button><button class="ai-btn ai-btn-danger" onclick={() => { confirmDeactivate = false; onDeactivate(); }}><OsycIcon name="log-out" size={15} /><span>确认退出</span></button></div></div>{/if}
</div>

<style>
    .ai-pane { --ai-chat-column: 768px; height: 100%; max-height: 100%; min-height: 0; min-width: 0; overflow: hidden; box-sizing: border-box; color: var(--osyc-ai-text, var(--text-normal)); background: var(--osyc-ai-background-color, var(--background-primary)); }
    .ai-shell { display: grid; grid-template-columns: minmax(232px, 24%) minmax(0, 1fr); height: 100%; min-height: 0; background: var(--background-primary); background-color: var(--osyc-ai-surface-alt, var(--background-secondary)); }
    .ai-sidebar { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 12px 10px; border-right: 1px solid var(--background-modifier-border); background: var(--background-secondary); }
    .ai-sidebar-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
    .ai-new-chat { flex: 1; min-width: 0; min-height: 40px; display: flex; align-items: center; gap: 9px; border: 1px solid var(--background-modifier-border); border-radius: 10px; padding: 0 12px; color: var(--text-normal); background: var(--background-primary); cursor: pointer; font: inherit; }
    .ai-new-chat:hover, .ai-session-item:hover, .ai-sidebar-action:hover { background: var(--background-modifier-hover); }
    .ai-session-list { flex: 1 1 0; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 1px; }
    .ai-session-group { padding: 14px 8px 6px; color: var(--text-faint); font-size: var(--font-ui-smaller); font-weight: 600; }
    /* Obsidian 的 button 基础样式会把内容居中；会话记录必须首字左对齐，
       所以显式声明 flex-start，并让标签占据剩余宽度。 */
    .ai-session-item { display: flex; align-items: center; justify-content: flex-start; gap: 9px; width: 100%; min-height: 38px; border: 0; border-radius: 8px; padding: 6px 8px; text-align: left; color: var(--text-normal); background: transparent; cursor: pointer; font: inherit; }
    .ai-session-item.active { background: var(--background-modifier-hover); color: var(--text-accent); }
    .ai-session-status { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; color: var(--text-faint); }
    .ai-session-status-running { color: var(--interactive-accent); animation: osyc-session-spin 1.4s linear infinite; }
    .ai-session-status-done { color: var(--color-green); }
    .ai-session-status-failed, .ai-session-status-conflict, .ai-session-status-delivery_failed { color: var(--color-red); }
    .ai-session-status-awaiting_confirmation { color: var(--color-orange); }
    .ai-session-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; font-size: var(--font-ui-small); }
    .ai-session-empty { padding: 12px 8px; color: var(--text-faint); font-size: var(--font-ui-smaller); }
    .ai-sidebar-actions { display: flex; flex-direction: column; gap: 2px; padding-top: 10px; border-top: 1px solid var(--background-modifier-border); }
    .ai-sidebar-action { display: flex; align-items: center; gap: 10px; min-height: 38px; border: 0; border-radius: 8px; padding: 0 8px; text-align: left; color: var(--text-muted); background: transparent; cursor: pointer; font: inherit; }
    .ai-sidebar-danger { color: var(--text-error); }
    .ai-sidebar-scrim { display: none; }
    .ai-chat { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; background: var(--background-primary); }
    .ai-chat-header { display: flex; align-items: center; gap: 6px; min-height: 52px; padding: 8px 14px; border-bottom: 1px solid var(--background-modifier-border); }
    .ai-chat-title { display: flex; flex-direction: column; min-width: 0; margin-right: auto; line-height: 1.2; }
    .ai-chat-title strong { font-family: var(--osyc-ai-heading-font-family, var(--font-interface)); font-size: var(--font-ui-medium); color: var(--text-normal); }
    .ai-chat-title span { color: var(--text-muted); font-size: var(--font-ui-smaller); }
    .ai-icon-btn { display: inline-grid; place-items: center; flex: 0 0 auto; width: 34px; height: 34px; border: 0; border-radius: 8px; color: var(--text-muted); background: transparent; cursor: pointer; }
    .ai-icon-btn:hover { color: var(--text-normal); background: var(--background-modifier-hover); }
    .ai-announcement-button { position: relative; }
    .ai-icon-dot { position: absolute; top: 6px; inset-inline-end: 6px; width: 6px; height: 6px; border-radius: 50%; background: var(--text-accent); }
    .ai-account-strip { display: flex; align-items: center; gap: 12px; padding: 4px 10px; border: none; border-radius: 8px; background: transparent; box-shadow: none; color: var(--text-muted); font-family: inherit; font-size: var(--font-ui-smaller); white-space: nowrap; cursor: pointer; }
    .ai-account-strip:hover { background-color: var(--background-modifier-hover); color: var(--text-normal); }
    .ai-account-strip b { color: var(--text-normal); }
    .ai-plan-badge { display: inline-flex; align-items: center; min-height: 22px; border-radius: 5px; padding: 0 7px; color: var(--text-on-accent); background: var(--text-faint); font-weight: 600; }
    .ai-plan-badge[data-plan="member"] { background: var(--interactive-accent); }
    .ai-plan-badge[data-plan="pro"] { background: var(--interactive-accent); }
    .ai-sync-badge { display: inline-flex; align-items: center; min-height: 22px; border-radius: 999px; padding: 0 8px; color: var(--text-on-accent); background: var(--color-green); font-size: var(--font-ui-smaller); font-weight: 700; }
    .ai-sync-badge[data-sync-status="degraded"] { background: var(--color-orange); }
    .ai-sync-badge[data-sync-status="failed"] { background: var(--text-error); }
    .ai-sync-badge[data-sync-status="unknown"] { background: var(--text-faint); }
    .ai-chat-timeline, .ai-task-list { flex: 1 1 0; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; padding: 22px clamp(12px, 4vw, 36px) 6px; overscroll-behavior: contain; }
    .ai-conversation { display: flex; flex-direction: column; gap: 20px; width: 100%; max-width: var(--ai-chat-column); margin: 0 auto 28px; }
    .ai-message { display: flex; gap: 12px; min-width: 0; }
    .ai-message-user { justify-content: flex-end; }
    .ai-message-user .ai-message-body { max-width: min(78%, 620px); padding: 10px 14px; border: 1px solid var(--osyc-ai-border, var(--background-modifier-border)); border-radius: 16px; color: var(--osyc-ai-text, var(--text-normal)); background: var(--osyc-ai-surface-alt, var(--background-secondary)); white-space: pre-wrap; overflow-wrap: anywhere; }
    .ai-message-assistant { align-items: flex-start; }
    .ai-welcome, .ai-activation { display: flex; flex-direction: column; align-items: center; max-width: 560px; margin: 12vh auto 0; text-align: center; color: var(--text-muted); }
    .ai-welcome h1, .ai-activation h2 { margin: 0 0 8px; color: var(--text-normal); font-size: clamp(1.4rem, 3vw, 2rem); }
    .ai-welcome p, .ai-activation p { margin: 0 0 20px; line-height: 1.6; }
    .ai-welcome-mark { display: grid; place-items: center; width: 46px; height: 46px; margin-bottom: 18px; border-radius: 12px; color: var(--text-on-accent); background: var(--interactive-accent); font-weight: 700; }
    .ai-welcome-empty { margin: auto; }
    .ai-activation { gap: 10px; width: min(100%, 360px); }
    .ai-activation .ai-field { width: 100%; }
    .ai-onboard-icon { display: grid; place-items: center; width: 52px; height: 52px; margin-bottom: 4px; border-radius: 14px; color: var(--text-on-accent); background: var(--interactive-accent); }
    .ai-quick-list { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; max-width: 680px; }
    .ai-quick-chip { display: inline-flex; align-items: center; gap: 7px; min-height: 38px; border: 1px solid var(--background-modifier-border); border-radius: 10px; padding: 7px 12px; color: var(--text-muted); background: var(--background-secondary); cursor: pointer; font: inherit; }
    .ai-quick-chip:hover { color: var(--text-normal); border-color: var(--interactive-accent); }
    .ai-composer { flex: 0 0 auto; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px clamp(12px, 4vw, 36px) max(10px, env(safe-area-inset-bottom)); background: var(--background-primary); }
    .ai-composer-box { width: 100%; max-width: var(--ai-chat-column); box-sizing: border-box; border: 1px solid var(--osyc-ai-border, var(--background-modifier-border)); border-radius: 22px; padding: 8px 10px 6px; background: var(--osyc-ai-surface-alt, var(--background-secondary)); }
    .ai-composer-input { box-sizing: border-box; width: 100%; min-height: 26px; max-height: 180px; border: 0; padding: 2px 4px; resize: none; overflow-y: auto; color: var(--osyc-ai-text, var(--text-normal)); background-color: transparent; font: inherit; line-height: 1.5; }
    .ai-composer-input:focus { outline: none; }
    .ai-field { box-sizing: border-box; width: 100%; border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 10px 12px; color: var(--text-normal); background: var(--background-primary-alt); font: inherit; }
    .ai-field:focus { outline: none; border-color: var(--interactive-accent); }
    .ai-composer-foot, .ai-panel-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .ai-send-btn { display: inline-grid; place-items: center; flex: 0 0 auto; width: 34px; height: 34px; border: 0; border-radius: 50%; color: var(--text-on-accent); background: var(--interactive-accent); cursor: pointer; }
    .ai-send-btn:hover { background: var(--interactive-accent-hover, var(--interactive-accent)); }
    .ai-send-btn:disabled { opacity: .4; cursor: default; }
    .ai-mobile-menu, .ai-mobile-close { display: none; }
    .ai-hint, .ai-notice { color: var(--text-muted); font-size: var(--font-ui-smaller); }
    .ai-banner, .ai-suggestion { max-width: var(--ai-chat-column); margin: 8px auto; }
    .ai-banner { display: flex; align-items: center; gap: 7px; padding: 7px 12px; color: var(--text-normal); background: var(--background-modifier-warning); font-size: var(--font-ui-smaller); }
    .ai-banner-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-warning); }
    .ai-suggestion { display: flex; flex-direction: row; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; border: 1px solid var(--background-modifier-border); border-radius: 10px; color: var(--text-muted); background: var(--background-secondary); font-size: var(--font-ui-smaller); }
    .ai-suggestion > div { display: flex; gap: 8px; }
    .ai-text-btn, .ai-btn { min-height: 34px; border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 6px 11px; color: var(--text-normal); background: var(--background-primary); cursor: pointer; font: inherit; }
    .ai-text-btn { border: 0; padding-inline: 2px; color: var(--text-accent); background: transparent; }
    .ai-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
    .ai-btn-primary { color: var(--text-on-accent); border-color: var(--interactive-accent); background: var(--interactive-accent); }
    .ai-btn-danger { color: var(--text-on-accent); border-color: var(--text-error); background: var(--text-error); }
    .ai-confirm-panel { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid var(--background-modifier-border); border-radius: 10px; background: var(--background-secondary); }
    .ai-confirm-floating { position: absolute; z-index: 3; inset: 50% auto auto 50%; transform: translate(-50%, -50%); width: min(90%, 360px); box-shadow: var(--shadow-l); }
    .ai-confirm-panel p { margin: 0; color: var(--text-muted); font-size: var(--font-ui-smaller); }
    @keyframes osyc-session-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
        .ai-session-status-running { animation: none; }
        .ai-sidebar { transition: none; }
    }
    @media (min-width: 721px) {
        .ai-shell.ai-sidebar-collapsed { grid-template-columns: 56px minmax(0, 1fr); }
        .ai-shell.ai-sidebar-collapsed .ai-sidebar { padding: 12px 8px; }
        .ai-shell.ai-sidebar-collapsed .ai-session-list { display: none; }
        .ai-shell.ai-sidebar-collapsed .ai-new-chat { flex: 1; padding: 0; justify-content: center; }
        .ai-shell.ai-sidebar-collapsed .ai-new-chat .ai-control-label,
        .ai-shell.ai-sidebar-collapsed .ai-sidebar-action .ai-control-label { display: none; }
        .ai-shell.ai-sidebar-collapsed .ai-sidebar-action { justify-content: center; padding: 0; }
    }
    @media (max-width: 720px) {
        .ai-pane { height: 100%; padding-bottom: max(8px, env(safe-area-inset-bottom)); }
        .ai-shell { display: block; position: relative; }
        .ai-chat { height: 100%; }
        .ai-sidebar { position: absolute; z-index: 2; inset: 0 auto 0 0; width: min(86vw, 320px); border-radius: 0 14px 14px 0; transform: translateX(-102%); transition: transform .18s ease; box-shadow: var(--shadow-l); }
        .ai-sidebar-open .ai-sidebar { transform: translateX(0); }
        .ai-sidebar-open .ai-sidebar-scrim { display: block; position: absolute; z-index: 1; inset: 0; border: 0; padding: 0; background: var(--background-modifier-cover); cursor: pointer; }
        .ai-sidebar-toggle { display: none; }
        .ai-mobile-menu, .ai-mobile-close { display: inline-grid; }
        .ai-chat-header { padding-inline: 10px; }
        .ai-account-strip { gap: 6px; font-size: 11px; }
        .ai-account-strip span:nth-child(2) { display: none; }
        .ai-sync-badge { display: none; }
        .ai-chat-timeline { padding: 18px 12px 4px; }
        .ai-composer { padding-inline: 12px; }
        .ai-message-user .ai-message-body { max-width: 84%; }
        .ai-banner, .ai-suggestion { margin-inline: 12px; }
    }
</style>
