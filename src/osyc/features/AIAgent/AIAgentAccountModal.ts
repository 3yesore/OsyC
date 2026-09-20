import { Modal, Notice, Setting, type App, type ButtonComponent } from "@/deps.ts";
import { get } from "svelte/store";
import { openOsycSettings } from "./OsycSettingsModal";
import { isProNamespaceReadOnly } from "./CmdAIAgent";
import type { CmdAIAgent, PlanType, AIEntitlements, AIAgentSyncState, ProNamespaceState } from "./CmdAIAgent";
import { LiveSyncConfirmModal } from "./LiveSyncConfirmModal";
import { describeLiveSyncError, runLiveSyncAction, summarizeSyncDiagnostics, visibleLiveSyncActions, withBusyButton } from "./livesyncSyncActions";
import type { LiveSyncActionDescriptor, LiveSyncControlPort, LiveSyncDiagnosticInput, LiveSyncDiagnosticView } from "./livesyncSyncActions";

const PLAN_LABEL: Record<PlanType, string> = {
    base: "基础版",
    member: "会员",
    pro: "Pro",
};

const SKILL_LABEL: Record<string, string> = {
    "basic-organize": "基础整理",
    "cloud-vault": "Cloud-Vault 备份",
    "defuddle": "网页内容提取",
    "graph-ai": "OC 关系图谱",
    "json-canvas": "Canvas 画布",
    "layout-polish": "排版精修",
    "obsidian-bases": "Bases 数据库",
    "obsidian-cli": "Obsidian 命令操作",
    "obsidian-markdown": "Markdown 笔记",
    priority: "优先队列",
    "smart-daily": "智能日记",
    "theme-custom": "主题自定义",
};

function formatSkillName(slug: string): string {
    const safe = slug.trim().replace(/[^a-zA-Z0-9_-]/g, "");
    return SKILL_LABEL[safe] ?? (safe.replace(/[-_]+/g, " ") || "未命名技能");
}

function queueLabel(plan: PlanType): string {
    if (plan === "pro") return "优先队列";
    if (plan === "member") return "会员队列";
    return "标准队列";
}

/** 各档位的升级引导文案。pro 为最高档，给空字符串表示不显示升级区。 */
const UPGRADE_HINT: Record<PlanType, string> = {
    base: "升级到会员 / Pro，解锁：定时整理、专属 OC 技能、云端私有空间备份与优先队列。",
    member: "升级到 Pro，解锁：优先队列、更多 Cloud-Vault 空间与最多 10 台设备。",
    pro: "",
};

const SYNC_STATUS_LABEL: Record<AIAgentSyncState["status"], string> = {
    ok: "正常",
    degraded: "降级",
    failed: "失败",
    unknown: "未知",
};

const SYNC_CONFLICT_LABEL: Record<AIAgentSyncState["conflict_state"], string> = {
    none: "无冲突",
    pending: "待处理",
    needs_user_action: "需要用户处理",
};

function formatSyncTime(value: number | null): string {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "—";
    const ts = value < 100_000_000_000 ? Math.round(value * 1000) : Math.round(value);
    return new Date(ts).toLocaleString("zh-CN");
}

/** 把 Pro 空间状态转成一行中文文案；非 Pro 原样回传服务端 403 detail。 */
function describeProNamespace(state: ProNamespaceState): string {
    if (!state.available) return state.message || "Pro 会员专属权益";
    const parts = [
        state.namespace ? `库名 ${state.namespace}` : "库名 —",
        state.enabled ? "已开通" : "未开通",
        state.ready ? "就绪" : "未就绪",
        state.read_only ? "只读保留" : "可读写",
        `已用 ${state.used_mb} MB`,
    ];
    return parts.join(" · ");
}

/**
 * 「我的账户」详情弹窗。
 *
 * 只展示后端下发的 plan / entitlements，不做任何权限判断 —— 权限以后端为准，
 * 本地展示被篡改也不影响实际能力（agent 执行时后端会再校验）。
 *
 * 版面遵循 Obsidian 官方设置基线：分组一律由 `Setting.setHeading()` 生成，
 * 低频区块用原生 `<details>` 折叠，避免所有内容平铺成一长列。
 *
 * 升级不是真购买（当前购买走闲鱼卡密），这里只给引导文案，
 * 提示用户去购买对应档位的卡密再激活。
 */
export class AIAgentAccountModal extends Modal {
    constructor(app: App, private agent: CmdAIAgent) {
        super(app);
    }

    override onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("osyc-account-modal");
        const state = get(this.agent.state);
        const plan: PlanType = state.plan || "base";
        const ent = state.entitlements;

        contentEl.createEl("h2", { text: "我的账户" });

        // ── 概览：档位 + 账本 ──
        const badgeRow = contentEl.createDiv({ cls: "ai-account-badge-row" });
        const badge = badgeRow.createDiv({ cls: "ai-account-badge" });
        badge.textContent = PLAN_LABEL[plan] ?? plan;
        badge.setAttribute("data-plan", plan);
        badgeRow.createSpan({ text: queueLabel(plan), cls: "ai-account-badge-note" });

        const expireText = state.expireAt
            ? new Date(state.expireAt).toLocaleDateString("zh-CN")
            : "—";

        new Setting(contentEl).setName("剩余积分").setDesc(`${state.credits} 分`);
        new Setting(contentEl).setName("到期时间").setDesc(expireText);

        // ── 权益总览 ──
        new Setting(contentEl).setName("权益总览").setHeading();
        if (ent) {
            this.renderEntitlements(contentEl, ent, plan);
        } else {
            contentEl.createEl("p", { text: "权益信息加载中…", cls: "ai-account-hint" });
        }

        // ── 同步状态 ──
        new Setting(contentEl).setName("同步状态").setHeading();
        this.renderSyncState(contentEl, state.syncState);

        // ── 设备与自带 Key（折叠，中低频）──
        this.renderFold(contentEl, "设备与自带 Key", false, (body) => {
            this.renderDeviceSection(body);
        });

        // ── 账户操作（折叠，低频）──
        this.renderFold(contentEl, "账户操作", false, (body) => {
            this.renderEmailLogin(body);
            this.renderRecharge(body);
            this.renderReactivation(body);
            this.renderProNamespace(body);
            this.renderUpgradeHint(body, plan);
        });

        new Setting(contentEl).addButton((btn) =>
            btn.setButtonText("关闭").setIcon("x").setCta().onClick(() => this.close())
        );
    }

    /**
     * 官方分组基线：标题用 `setHeading()`，正文放进原生 `<details>` 折叠体。
     * 默认收起低频区块，保持首屏只有概览 / 权益 / 同步三段。
     */
    private renderFold(
        container: HTMLElement,
        title: string,
        open: boolean,
        render: (body: HTMLElement) => void
    ): void {
        const details = container.createEl("details", { cls: "ai-account-fold" });
        if (open) details.setAttribute("open", "open");
        details.createEl("summary", { text: title, cls: "ai-account-fold-summary" });
        const body = details.createDiv({ cls: "ai-account-fold-body" });
        render(body);
    }

    /** 权益条目：顺序固定为 同步 / 任务 / 定时 / 云空间 / 队列 / 设备。 */
    private renderEntitlements(contentEl: HTMLElement, ent: AIEntitlements, plan: PlanType) {
        new Setting(contentEl).setName("私有同步").setDesc(ent.sync ? "已开通" : "未开通");
        new Setting(contentEl).setName("OC 整理任务").setDesc(ent.aiTasks ? "已开通" : "未开通");
        new Setting(contentEl).setName("定时整理").setDesc(ent.schedules ? "已开通" : "未开通（会员/Pro）");
        new Setting(contentEl).setName("Cloud-Vault 空间").setDesc(
            ent.cloudVault ? `已开通（${ent.cloudQuotaMb || 0} MB）` : "未开通（会员/Pro）"
        );
        new Setting(contentEl).setName("队列优先级").setDesc(queueLabel(plan));
        new Setting(contentEl).setName("设备数上限").setDesc(`${ent.maxDevices} 台`);
        this.renderSkills(contentEl, ent);
    }

    private renderUpgradeHint(contentEl: HTMLElement, plan: PlanType) {
        const hint = UPGRADE_HINT[plan];
        if (!hint) return;
        new Setting(contentEl).setName("升级解锁更多").setHeading();
        contentEl.createEl("p", { text: hint, cls: "ai-account-hint" });
        contentEl.createEl("p", {
            text: "购买对应档位的卡密后，回到激活页输入即可升级。",
            cls: "ai-account-hint",
        });
    }

    /** 设备与自带 Key 区块。未激活时给提示；已激活则异步拉取并渲染。 */
    private renderDeviceSection(contentEl: HTMLElement) {
        const box = contentEl.createDiv();
        if (!get(this.agent.state).activated) {
            box.createEl("p", { text: "激活账户后可管理已绑定设备。", cls: "ai-account-hint" });
            return;
        }
        box.createEl("p", { text: "加载中…", cls: "ai-account-hint" });
        void this.refreshDevices(box);
    }

    private async refreshDevices(box: HTMLElement) {
        await this.agent.loadDevices();
        const d = get(this.agent.state).devices;
        if (d.error) {
            box.empty();
            box.createEl("p", { text: d.error, cls: "ai-account-hint" });
            return;
        }
        box.empty();

        // 设备列表
        box.createEl("p", {
            text: `已绑定设备 ${d.devices.length} / ${d.max_devices}`,
            cls: "ai-account-hint",
        });
        for (const dev of d.devices) {
            const setting = new Setting(box);
            setting.setName(dev.is_current ? `${dev.device_id}（本机）` : dev.device_id);
            // 不展示 has_byo_key：BYOK 未启用，任何设备都实走 OsyC 额度。
            setting.setDesc("走 OsyC 额度");
            if (!dev.is_current) {
                setting.addButton((btn) =>
                    btn.setButtonText("撤销").setIcon("trash-2").onClick(async () => {
                        const res = await this.agent.revokeDevice(dev.device_id);
                        if (res.ok) {
                            await this.refreshDevices(box);
                        } else {
                            box.createEl("p", { text: res.message, cls: "ai-account-hint" });
                        }
                    })
                );
            }
        }

        // 自带 API Key：暂未启用（口径 2026-09-20：计划 2.# 版本开放）。
        // 生产 AGENT_BACKEND=hermes 不读 devices.byo_key，填了也不生效 ——
        // 界面不得提供填写入口，否则等于对用户承诺一个不存在的功能。
        // 注意：待 hermes 真正接通 BYO 消费路径后，才恢复输入框与保存按钮，
        //    届时同步更新服务公告与本处文案（agent 层 saveByoKey/clearByoKey 保留备用）。
        new Setting(box)
            .setName("自带 API Key（暂未开放）")
            .setDesc("该能力计划在 2.# 版本提供；在此之前，所有任务一律按 OsyC 积分结算。")
            .setDisabled(true);
    }

    private renderSkills(contentEl: HTMLElement, ent: AIEntitlements) {
        const setting = new Setting(contentEl).setName("专属 OC 技能");
        if (ent.skills && ent.skills.length > 0) {
            const list = setting.controlEl.createDiv({ cls: "ai-account-skills" });
            for (const s of ent.skills) {
                list.createSpan({ text: formatSkillName(s), cls: "ai-account-skill", attr: { title: s } });
            }
        } else {
            setting.setDesc("当前档位暂无专属能力");
        }
    }

    private renderSyncState(contentEl: HTMLElement, syncState: AIAgentSyncState) {
        const box = contentEl.createDiv({ cls: "ai-account-sync" });
        const title = box.createDiv({ cls: "ai-account-sync-title" });
        title.createSpan({ text: "同步状态" });
        const pill = title.createSpan({ cls: "ai-account-sync-pill" });
        const enabledLabel = SYNC_STATUS_LABEL[syncState.status] ?? "未知";
        pill.textContent = syncState.enabled ? enabledLabel : "未启用";
        pill.setAttribute("data-sync-status", syncState.enabled ? syncState.status : "unknown");

        const grid = box.createDiv({ cls: "ai-account-sync-grid" });
        grid.createEl("strong", { text: "Vault" });
        grid.createSpan({ text: syncState.vault_name ?? "—" });
        grid.createEl("strong", { text: "最近下行" });
        grid.createSpan({ text: formatSyncTime(syncState.last_pull_at) });
        grid.createEl("strong", { text: "最近上行" });
        grid.createSpan({ text: formatSyncTime(syncState.last_push_at) });
        grid.createEl("strong", { text: "延迟" });
        grid.createSpan({ text: syncState.staleness_seconds == null ? "—" : `${syncState.staleness_seconds} 秒` });
        grid.createEl("strong", { text: "冲突" });
        grid.createSpan({ text: SYNC_CONFLICT_LABEL[syncState.conflict_state] ?? "—" });
        if (syncState.markdown_files != null || syncState.total_files != null) {
            grid.createEl("strong", { text: "同步覆盖" });
            grid.createSpan({
                text: `${syncState.markdown_files ?? 0} 篇 Markdown / ${syncState.total_files ?? 0} 个文件${syncState.empty_files ? `，空文件 ${syncState.empty_files}` : ""}`,
            });
        }

        if (syncState.last_error_hint || syncState.last_error_code) {
            box.createEl("p", {
                text: [
                    syncState.last_error_code ? `错误码 ${syncState.last_error_code}` : "",
                    syncState.last_error_hint ? syncState.last_error_hint : "",
                ].filter(Boolean).join(" · "),
                cls: "ai-account-hint",
            });
        } else {
            box.createEl("p", { text: "暂无同步错误", cls: "ai-account-hint" });
        }

        new Setting(contentEl)
            .setName("同步设置")
            .setDesc("打开 OsyC 设置弹窗；远端地址与口令属于 LiveSync，在弹窗底部的原生设置入口调整。")
            .addButton((btn) =>
                btn.setButtonText("打开").setIcon("settings").setCta().onClick(() => {
                    try {
                        openOsycSettings(this.app);
                    } catch (error) {
                        console.error("打开同步设置失败", error);
                    }
                })
            );

        new Setting(contentEl)
            .setName("重新同步")
            .setDesc("重新执行一次服务器握手并刷新同步覆盖率，不调用模型、不扣积分。")
            .addButton((btn) =>
                btn.setButtonText("刷新").setIcon("refresh-cw").setCta().onClick(async () => {
                    btn.setDisabled(true);
                    const result = await this.agent.refreshSync();
                    btn.setDisabled(false);
                    new Notice(result.message);
                    if (result.ok) this.onOpen();
                })
            );

        this.renderLiveSyncPanel(contentEl, syncState);
    }

    /**
     * LiveSync 诊断 + 动作区（同步区内的最后一段）。
     *
     * 现场事故的修法：把「远端里程碑是否已接受本机」显式列出来，
     * 并把常见的 LiveSync 动作收进这里，用户不必再去原生设置里手动点。
     * 诊断只读；动作全部经 core.services 端口执行，危险动作强制确认。
     */
    private renderLiveSyncPanel(contentEl: HTMLElement, syncState: AIAgentSyncState): void {
        const box = contentEl.createDiv({ cls: "ai-account-livesync" });
        const title = box.createDiv({ cls: "ai-account-sync-title" });
        title.createSpan({ text: "LiveSync 同步诊断" });
        const body = box.createDiv({ cls: "ai-account-livesync-body" });
        const refresh = () => { void this.paintLiveSyncPanel(body, syncState, refresh); };
        refresh();
    }

    private async paintLiveSyncPanel(
        body: HTMLElement,
        syncState: AIAgentSyncState,
        refresh: () => void
    ): Promise<void> {
        body.empty();
        body.createEl("p", { text: "正在读取 LiveSync 诊断…", cls: "ai-account-hint" });
        const control = this.agent.livesyncControl;
        if (!control) {
            body.empty();
            body.createEl("p", { text: "当前版本未接入 LiveSync 控制能力，无法执行同步操作。", cls: "ai-account-hint" });
            return;
        }
        let input: LiveSyncDiagnosticInput;
        try {
            input = await control.diagnose();
        } catch (error) {
            input = { error: "读取同步诊断失败：" + describeLiveSyncError(error) };
        }
        const view = summarizeSyncDiagnostics({
            ...input,
            lastPullAt: input.lastPullAt ?? syncState.last_pull_at,
            lastPushAt: input.lastPushAt ?? syncState.last_push_at,
        });
        // 诊断是异步的，弹窗可能已关闭；避免往已卸载的节点里写。
        if (!body.isConnected) return;
        body.empty();
        // 核心告警放最上面，必须用户一眼能看到。
        if (view.alert) body.createEl("p", { text: view.alert, cls: "ai-account-livesync-alert" });
        this.renderLiveSyncGrid(body, view);
        if (view.hint) body.createEl("p", { text: view.hint, cls: "ai-account-hint" });
        if (view.error) body.createEl("p", { text: view.error, cls: "ai-account-hint" });
        for (const action of visibleLiveSyncActions(view)) {
            if (action.risk === "critical") {
                // 最危险动作默认折叠，降低误点。
                const details = body.createEl("details", { cls: "ai-account-fold ai-account-livesync-danger" });
                details.createEl("summary", {
                    text: "最危险操作（用本机覆盖远端，默认收起）",
                    cls: "ai-account-fold-summary",
                });
                const inner = details.createDiv({ cls: "ai-account-fold-body" });
                this.renderLiveSyncAction(inner, action, control, refresh);
                continue;
            }
            this.renderLiveSyncAction(body, action, control, refresh);
        }
    }

    private renderLiveSyncGrid(box: HTMLElement, view: LiveSyncDiagnosticView): void {
        const grid = box.createDiv({ cls: "ai-account-sync-grid" });
        const rows: [string, string][] = [
            ["活动档案", view.configurationLabel],
            ["远端端点", view.endpointLabel],
            ["远端类型", view.remoteTypeLabel],
            ["协议版本", view.protocolVersionLabel],
            ["本机设备", view.nodeIdLabel],
            ["远端已接受", view.acceptedLabel],
            ["accepted_nodes", view.acceptedNodesLabel],
            ["最近拉取", view.lastPullLabel],
            ["最近推送", view.lastPushLabel],
        ];
        for (const [label, value] of rows) {
            grid.createEl("strong", { text: label });
            grid.createSpan({ text: value });
        }
    }

    private renderLiveSyncAction(
        container: HTMLElement,
        action: LiveSyncActionDescriptor,
        control: LiveSyncControlPort,
        refresh: () => void
    ): void {
        const setting = new Setting(container).setName(action.label).setDesc(action.description);
        setting.addButton((btn) => {
            btn.setButtonText(action.label).setIcon(action.icon);
            if (action.risk === "safe") btn.setCta();
            else btn.setWarning();
            btn.onClick(async () => {
                // 执行中禁用并显示进行中；withBusyButton 用 finally 恢复。
                await withBusyButton(btn, action.label, action.runningLabel, async () => {
                    const result = await runLiveSyncAction(action.id, control, (message) =>
                        this.confirmLiveSyncAction(action, message)
                    );
                    new Notice(result.message);
                });
                refresh();
            });
        });
    }

    /** danger 弹一次确认；critical 在弹窗里还要求输入确认词。 */
    private confirmLiveSyncAction(action: LiveSyncActionDescriptor, message: string): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            new LiveSyncConfirmModal(this.app, action, message, resolve).open();
        });
    }

    /** 充值积分：积分包卡密入口（调用后端 /api/recharge；不显示、不保存卡密原文）。 */
    private renderRecharge(contentEl: HTMLElement) {
        const setting = new Setting(contentEl)
            .setName("充值积分")
            .setDesc("输入积分包卡密即可充值到当前账户；充值活动赠送会一并到账。卡密原文不会被显示或保存。")
            .addButton((btn) =>
                btn.setButtonText("充值").setIcon("plus-circle").setCta().onClick(async () => {
                    const input = setting.controlEl.querySelector<HTMLInputElement>("input");
                    const cardKey = input?.value.trim() ?? "";
                    if (!cardKey) {
                        new Notice("请输入积分包卡密");
                        return;
                    }
                    btn.setDisabled(true);
                    const result = await this.agent.recharge(cardKey);
                    btn.setDisabled(false);
                    if (input) input.value = "";
                    new Notice(result.message);
                    if (result.ok) this.onOpen();
                })
            );
        const input = setting.controlEl.createEl("input", {
            type: "password",
            placeholder: "输入积分包卡密",
            attr: { autocomplete: "off", autocapitalize: "none", spellcheck: "false" },
        });
        input.addClass("ai-account-input");
    }

    private renderReactivation(contentEl: HTMLElement) {
        const setting = new Setting(contentEl)
            .setName("重新激活卡密")
            .setDesc("用于更换卡密、恢复同步配置或在新设备重新绑定。不会显示或保存卡密原文。")
            .addButton((btn) =>
                btn.setButtonText("重新激活").setIcon("key").setCta().onClick(async () => {
                    const input = setting.controlEl.querySelector<HTMLInputElement>("input");
                    const cardKey = input?.value.trim() ?? "";
                    if (!cardKey) {
                        new Notice("请输入卡密");
                        return;
                    }
                    btn.setDisabled(true);
                    const result = await this.agent.activate(cardKey);
                    btn.setDisabled(false);
                    if (input) input.value = "";
                    new Notice(result.message);
                    if (result.ok) this.onOpen();
                })
            );
        const input = setting.controlEl.createEl("input", {
            type: "password",
            placeholder: "输入新的卡密",
            attr: { autocomplete: "off", autocapitalize: "none", spellcheck: "false" },
        });
        input.addClass("ai-account-input");
    }

    /**
     * 邮箱登录 / 绑定卡密。
     *
     * 邮箱是高于卡密的身份锚点：验证通过后卡密跟着邮箱走，换设备只认邮箱 + 验证码。
     * 会话 token 只留在内存里（不落盘），插件重启后需要重新验证一次邮箱。
     */
    private renderEmailLogin(contentEl: HTMLElement) {
        const box = contentEl.createDiv({ cls: "ai-account-email-login" });
        box.createEl("p", {
            text: "邮箱是高于卡密的身份锚点：验证邮箱后绑定的卡密会自动载入，换设备只需邮箱验证码。",
            cls: "ai-account-hint",
        });

        const emailSetting = new Setting(box).setName("邮箱地址");
        const emailInput = emailSetting.controlEl.createEl("input", {
            type: "email",
            placeholder: "name@example.com",
            attr: { autocomplete: "email", autocapitalize: "none", spellcheck: "false" },
        });
        emailInput.addClass("ai-account-input");

        const statusEl = box.createEl("p", { text: "状态：尚未验证邮箱", cls: "ai-account-hint" });
        const setStatus = (text: string) => {
            statusEl.setText(`状态：${text}`);
        };

        let sendButton: ButtonComponent | null = null;
        let countdownTimer: number | null = null;
        const startCountdown = (seconds: number) => {
            if (!sendButton) return;
            let left = seconds;
            sendButton.setDisabled(true);
            sendButton.setButtonText(`重新发送（${left}s）`);
            countdownTimer = window.setInterval(() => {
                left -= 1;
                if (left <= 0) {
                    if (countdownTimer !== null) window.clearInterval(countdownTimer);
                    countdownTimer = null;
                    sendButton?.setDisabled(false);
                    sendButton?.setButtonText("发送验证码");
                    return;
                }
                sendButton?.setButtonText(`重新发送（${left}s）`);
            }, 1000);
        };

        emailSetting.addButton((btn) => {
            sendButton = btn;
            btn.setButtonText("发送验证码")
                .setIcon("send")
                .setCta()
                .onClick(async () => {
                    const email = emailInput.value.trim();
                    if (!email) {
                        new Notice("请输入邮箱地址");
                        return;
                    }
                    btn.setDisabled(true);
                    const result = await this.agent.requestEmailCode(email);
                    new Notice(result.message);
                    if (result.ok) {
                        startCountdown(60);
                        setStatus(`验证码已发送至 ${email}，5 分钟内有效`);
                    } else {
                        btn.setDisabled(false);
                        setStatus(result.message);
                    }
                });
        });

        const codeSetting = new Setting(box).setName("验证码");
        const codeInput = codeSetting.controlEl.createEl("input", {
            type: "text",
            placeholder: "6 位验证码",
            attr: { inputmode: "numeric", autocomplete: "one-time-code" },
        });
        codeInput.addClass("ai-account-input");
        codeSetting.addButton((btn) =>
            btn.setButtonText("登录").setIcon("log-in").setCta().onClick(async () => {
                btn.setDisabled(true);
                const result = await this.agent.loginWithEmail(emailInput.value, codeInput.value);
                btn.setDisabled(false);
                new Notice(result.message);
                setStatus(result.message);
                if (result.ok) {
                    codeInput.value = "";
                    this.onOpen();
                }
            })
        );

        const account = this.agent.emailAccount;
        if (account) {
            setStatus(`已登录 ${account.masked}`);
            const cards = account.cards.map((c) => c.card_key).join("、") || "暂未绑定卡密";
            box.createEl("p", { text: `已关联卡密：${cards}`, cls: "ai-account-hint" });
        }

        const bindSetting = new Setting(box)
            .setName("绑定卡密")
            .setDesc("把已有卡密并入当前邮箱账户；需要先完成一次邮箱验证。");
        const cardInput = bindSetting.controlEl.createEl("input", {
            type: "password",
            placeholder: "输入卡密",
            attr: { autocomplete: "off", autocapitalize: "none", spellcheck: "false" },
        });
        cardInput.addClass("ai-account-input");
        bindSetting.addButton((btn) =>
            btn.setButtonText("绑定").setIcon("link").setCta().onClick(async () => {
                const cardKey = cardInput.value.trim();
                if (!cardKey) {
                    new Notice("请输入卡密");
                    return;
                }
                btn.setDisabled(true);
                const result = await this.agent.bindCardToEmail(cardKey);
                btn.setDisabled(false);
                if (result.ok) cardInput.value = "";
                new Notice(result.message);
                setStatus(result.message);
                if (result.ok) this.onOpen();
            })
        );
    }

    /**
     * Pro「独立同步空间」区块：显式开通 + 迁移进度回显。
     *
     * 打开弹窗只做一次 GET 状态回显（只读）；真正切换同步目标只发生在用户点击
     * 「开通并切换到独立空间」时。非 Pro 卡服务端返回 403，这里原样展示 detail，
     * 并把按钮保持在不可用状态；Pro 已过期是 200 + status=expired / read_only=true，
     * 这里展示「只读保留」并给续费引导，按钮不整块禁用。
     */
    private renderProNamespace(contentEl: HTMLElement) {
        const box = contentEl.createDiv({ cls: "ai-account-pro-namespace" });
        new Setting(box).setName("独立同步空间").setHeading();
        box.createEl("p", {
            text: "Pro 专属能力「独立同步空间」是一个独立数据库。切换后本 vault 同步到独立空间，旧空间数据保留、可随时切回。",
            cls: "ai-account-hint",
        });
        const statusEl = box.createEl("p", { text: "空间状态：加载中…", cls: "ai-account-hint" });
        const renewEl = box.createEl("p", { text: "", cls: "ai-account-hint" });

        let button: ButtonComponent | null = null;
        const renderStatus = (state: ProNamespaceState | null) => {
            if (!state) {
                statusEl.setText("空间状态：读取失败，请稍后重试");
                button?.setDisabled(true);
                return;
            }
            const expired = isProNamespaceReadOnly(state);
            statusEl.setText(`空间状态：${describeProNamespace(state)}${expired ? " · 只读保留" : ""}`);
            if (expired) {
                renewEl.setText("Pro 订阅已过期：空间数据只读保留（不会删除，可导出），续费后即可恢复读写。");
                // 过期不等于无权限：按钮保留可点，点击给续费引导，整块不禁用。
                button?.setDisabled(false);
                button?.setButtonText("去续费");
            } else {
                renewEl.setText("");
                button?.setButtonText("开通并切换到独立空间");
                // 非 Pro（403）时 available=false，按钮保持不可用。
                button?.setDisabled(!state.available);
            }
        };

        new Setting(box)
            .setName("当前空间")
            .setDesc("切换会改变本 vault 的同步目标；旧空间数据不会被删除，可切回。")
            .addButton((btn) => {
                button = btn;
                btn.setButtonText("开通并切换到独立空间")
                    .setIcon("database")
                    .setCta()
                    .setDisabled(true);
                // 仅用户点击才切换档案；onOpen 里绝不调用开通。
                btn.onClick(async () => {
                    const state = this.agent.proNamespace;
                    if (state && isProNamespaceReadOnly(state)) {
                        new Notice("Pro 订阅已过期：空间处于只读保留，请先续费（重新激活卡密）后再开通或切换；数据不会删除。");
                        return;
                    }
                    if (!state?.available) return;
                    btn.setDisabled(true);
                    btn.setButtonText("正在开通并切换…");
                    const result = await this.agent.requestProNamespace();
                    new Notice(result.message);
                    if (result.ok) {
                        // 完成后整块重绘，回显新空间、用量与只读状态。
                        this.onOpen();
                        return;
                    }
                    renderStatus(this.agent.proNamespace);
                    btn.setButtonText("开通并切换到独立空间");
                });
            });

        if (!get(this.agent.state).activated) {
            statusEl.setText("空间状态：激活账户后可查看 Pro 专属空间");
            return;
        }
        // 只读回显服务端状态，不切换任何档案。
        void this.agent.proNamespaceStatus().then(() => renderStatus(this.agent.proNamespace));
    }

    override onClose() {
        this.contentEl.empty();
        this.contentEl.removeClass("osyc-account-modal");
    }
}
