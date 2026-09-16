import { Modal, Notice, Setting, type App } from "@/deps.ts";
import { get } from "svelte/store";
import { openObsidianSettings } from "@/common/obsidianSettings.ts";
import type { CmdAIAgent, PlanType, AIEntitlements, AIAgentSyncState } from "./CmdAIAgent";

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
            this.renderReactivation(body);
            this.renderEmailLoginTemplate(body);
            this.renderUpgradeHint(body, plan);
        });

        new Setting(contentEl).addButton((btn) =>
            btn.setButtonText("关闭").setCta().onClick(() => this.close())
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
            box.createEl("p", { text: "激活账户后可管理设备与自带 Key。", cls: "ai-account-hint" });
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
            setting.setDesc(dev.has_byo_key ? "已配自带 Key" : "走 OsyC 额度");
            if (!dev.is_current) {
                setting.addButton((btn) =>
                    btn.setButtonText("撤销").onClick(async () => {
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

        // 自带 API Key（仅作用于本机）
        const byo = new Setting(box)
            .setName("自带 API Key")
            .setDesc("填了后本机执行真实模型走你的额度，不消耗 OsyC 配额");
        const input = byo.controlEl.createEl("input", {
            cls: "ai-account-input",
            type: "password",
            placeholder: "sk-...",
        });
        byo.addButton((btn) =>
            btn.setButtonText("保存").setCta().onClick(async () => {
                const res = await this.agent.saveByoKey(input.value);
                if (res.ok) {
                    input.value = "";
                    await this.refreshDevices(box);
                } else {
                    box.createEl("p", { text: res.message, cls: "ai-account-hint" });
                }
            })
        );
        const cur = d.devices.find((x) => x.is_current);
        if (cur?.has_byo_key) {
            byo.addButton((btn) =>
                btn.setButtonText("清空").onClick(async () => {
                    await this.agent.clearByoKey();
                    await this.refreshDevices(box);
                })
            );
        }
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
            .setDesc("打开 LiveSync 的 Synchronisation 页面，查看和调整同步配置。")
            .addButton((btn) =>
                btn.setButtonText("打开").setCta().onClick(() => {
                    try {
                        openObsidianSettings(this.app, "synchronisation");
                    } catch (error) {
                        console.error("打开同步设置失败", error);
                    }
                })
            );

        new Setting(contentEl)
            .setName("重新同步")
            .setDesc("重新执行一次服务器握手并刷新同步覆盖率，不调用模型、不扣积分。")
            .addButton((btn) =>
                btn.setButtonText("刷新").setCta().onClick(async () => {
                    btn.setDisabled(true);
                    const result = await this.agent.refreshSync();
                    btn.setDisabled(false);
                    new Notice(result.message);
                    if (result.ok) this.onOpen();
                })
            );
    }

    private renderReactivation(contentEl: HTMLElement) {
        const setting = new Setting(contentEl)
            .setName("重新激活卡密")
            .setDesc("用于更换卡密、恢复同步配置或在新设备重新绑定。不会显示或保存卡密原文。")
            .addButton((btn) =>
                btn.setButtonText("重新激活").setCta().onClick(async () => {
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

    /** Preview the next-version email flow without enabling or contacting the server. */
    private renderEmailLoginTemplate(contentEl: HTMLElement) {
        const box = contentEl.createDiv({ cls: "ai-account-email-login" });
        box.createEl("p", {
            text: "邮箱登录将在后续版本开放。当前版本不会发送邮件、保存邮箱或改变卡密登录。",
            cls: "ai-account-hint",
        });
        const email = new Setting(box).setName("邮箱地址");
        const emailInput = email.controlEl.createEl("input", {
            type: "email",
            placeholder: "name@example.com",
            attr: { autocomplete: "email" },
        });
        emailInput.disabled = true;
        email.addButton((button) => button.setButtonText("发送验证码").setDisabled(true));
        const code = new Setting(box).setName("验证码");
        const codeInput = code.controlEl.createEl("input", {
            type: "text",
            placeholder: "6 位验证码",
            attr: { inputmode: "numeric", autocomplete: "one-time-code" },
        });
        codeInput.disabled = true;
        code.addButton((button) => button.setButtonText("登录").setDisabled(true));
        box.createEl("p", { text: "状态：feature_disabled · 倒计时：—", cls: "ai-account-hint" });
    }

    override onClose() {
        this.contentEl.empty();
        this.contentEl.removeClass("osyc-account-modal");
    }
}
