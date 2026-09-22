import { Modal, Notice, Setting, setIcon, type App } from "@/deps.ts";
import { get } from "svelte/store";
import { openOsycSettings } from "./OsycSettingsModal";
import { OsycAccountSectionModal, type OsycAccountSectionKind } from "./OsycAccountSectionModal";
import { describeEmailEntryStatus, describeProNamespaceEntryStatus } from "./osycAccountSections";
import { withBusyButton } from "./livesyncSyncActions";
import type { AITask, CmdAIAgent } from "./CmdAIAgent";
import { osycLogger } from "@/osyc/serviceFeatures/osycLogger";

/** 工具中心「上传脱敏诊断」用的合成任务：没有真实任务也能提交诊断。 */
export function createManualDiagnosticTask(): AITask {
    const id = `manual-${Date.now()}`;
    return {
        taskId: id,
        clientId: id,
        message: "",
        status: "manual",
        error: "用户主动上传诊断",
        createdAt: Date.now(),
    };
}

type ToolsTab = "account" | "recharge" | "debug";

const TAB_LABEL: Record<ToolsTab, string> = {
    account: "账户",
    recharge: "充值",
    debug: "调试",
};

/** Obsidian built-in icons, so the tabs do not depend on emoji fonts. */
const TAB_ICON: Record<ToolsTab, string> = {
    account: "user",
    recharge: "credit-card",
    debug: "bug",
};

const PLAN_LABEL: Record<string, string> = {
    base: "基础版",
    member: "会员",
    pro: "Pro",
};

/** Native Obsidian tools centre for account-related OC actions. */
export class AIAgentToolsModal extends Modal {
    private tab: ToolsTab = "account";
    private recharging = false;
    private uploadingDiagnostics = false;
    /** Pro 空间状态只读回显只发一次 GET，避免每次重绘都打服务端。 */
    private proStatusRequested = false;

    constructor(
        app: App,
        private agent: CmdAIAgent,
        private openAccountDetails: () => void,
        /** 诊断上传端口；接线层注入。未接入时按钮给出明确提示，不静默失败。 */
        private uploadDiagnostics?: (task: AITask) => Promise<{ ok: boolean; message: string }>,
    ) {
        super(app);
    }

    override onOpen(): void {
        this.modalEl.addClass("ai-tools-modal");
        this.render();
    }

    override onClose(): void {
        this.contentEl.empty();
        this.modalEl.removeClass("ai-tools-modal");
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "OC 工具中心" });

        const tabs = contentEl.createDiv({ cls: "ai-tools-tabs", attr: { role: "tablist", "aria-label": "OC 工具中心" } });
        for (const tab of Object.keys(TAB_LABEL) as ToolsTab[]) {
            const button = tabs.createEl("button", {
                cls: "ai-tools-tab",
                attr: {
                    type: "button",
                    role: "tab",
                    "aria-selected": String(this.tab === tab),
                    "data-osyc-tools-tab": tab,
                },
            });
            button.toggleClass("is-active", this.tab === tab);
            setIcon(button.createSpan({ cls: "ai-tools-tab-icon" }), TAB_ICON[tab]);
            button.createSpan({ cls: "ai-tools-tab-label", text: TAB_LABEL[tab] });
            button.onclick = () => {
                this.tab = tab;
                this.render();
            };
        }

        const panel = contentEl.createDiv({ cls: "ai-tools-panel", attr: { role: "tabpanel" } });
        if (this.tab === "account") this.renderAccount(panel);
        if (this.tab === "recharge") this.renderRecharge(panel);
        if (this.tab === "debug") this.renderDebug(panel);
    }

    private renderAccount(contentEl: HTMLElement): void {
        const state = get(this.agent.state);

        // 分工：权益明细只在「我的账户」里展示，这里仅保留操作与跳转，
        // 避免同一份权益在两处各排一版、口径还不一致。
        const plan = PLAN_LABEL[state.plan] ?? state.plan;
        new Setting(contentEl)
            .setName("我的账户")
            .setDesc(`当前为「${plan}」。权益明细、已绑定设备与同步状态都在账户详情中查看。`)
            .addButton((button) => button.setButtonText("打开详情").setIcon("user").setCta().onClick(() => {
                this.close();
                this.openAccountDetails();
            }));

        // 同步修复与重新激活：工具中心的账户页也必须有同名常显入口，
        // 保证「账户弹窗」与「工具中心」两条路径都能找到（2.0.17 移动端实测）。
        this.renderSyncRepair(contentEl);
        this.renderReactivation(contentEl);

        // 账户身份入口：两个入口放在一起，只负责打开对应界面。
        // 渲染入口不登录、不发码、不切换同步空间（显式动作口径）。
        this.renderEmailEntry(contentEl);
        this.renderProNamespaceEntry(contentEl);

        if (state.cloudVault.available) {
            new Setting(contentEl)
                .setName("Cloud-Vault 备份")
                .setDesc(state.cloudVault.snapshots.length > 0 ? `已有 ${state.cloudVault.snapshots.length} 个快照` : "尚无备份快照")
                .addButton((button) => button.setButtonText("立即备份").setIcon("database").onClick(async () => {
                    button.setDisabled(true);
                    const result = await this.agent.cloudBackup();
                    button.setDisabled(false);
                    new Notice(result.message);
                    if (result.ok) this.render();
                }));
        }

        new Setting(contentEl)
            .setName("OsyC 设置")
            .setDesc("打开 OsyC 设置弹窗，调整连接、外观、交互与诊断。")
            .addButton((button) => button.setButtonText("打开设置").setIcon("settings").setCta().onClick(() => {
                // 先收起工具中心再开设置弹窗，避免两个弹窗叠在一起。
                this.close();
                try {
                    openOsycSettings(this.app);
                } catch (error) {
                    console.error("打开 OsyC 设置失败", error);
                    new Notice("无法打开 OsyC 设置");
                }
            }));
    }

    /**
     * 「修复同步配置」：与账户弹窗同名同实现 —— 一键执行幂等窄补丁自愈，
     * 并立刻拉取一次，用 Notice 报结果。常显，不放进任何折叠区。
     */
    private renderSyncRepair(contentEl: HTMLElement): void {
        new Setting(contentEl)
            .setName("修复同步配置")
            .setDesc("自动纠正导致同步静默中止的分块参数与远端类型，并立即拉取一次；不改远端地址与凭据。")
            .addButton((button) =>
                button.setButtonText("一键修复").setIcon("wrench").setCta().onClick(async () => {
                    const control = this.agent.livesyncControl;
                    if (!control) {
                        new Notice("当前版本未接入 LiveSync 控制能力，无法修复同步配置");
                        return;
                    }
                    await withBusyButton(button, "一键修复", "修复中…", async () => {
                        const result = await control.repairSyncConfiguration();
                        new Notice(result.message);
                    });
                    this.render();
                })
            );
    }

    /**
     * 「重新激活卡密」：与账户弹窗同一份交互（输入卡密，调用 activate），
     * 工具中心的账户页常显入口。不显示、不保存卡密原文。
     */
    private renderReactivation(contentEl: HTMLElement): void {
        const setting = new Setting(contentEl)
            .setName("重新激活卡密")
            .setDesc("用于更换卡密、恢复同步配置或在新设备重新绑定。不会显示或保存卡密原文。")
            .addButton((button) =>
                button.setButtonText("重新激活").setIcon("key").setCta().onClick(async () => {
                    const input = setting.controlEl.querySelector<HTMLInputElement>("input");
                    const cardKey = input?.value.trim() ?? "";
                    if (!cardKey) {
                        new Notice("请输入卡密");
                        return;
                    }
                    button.setDisabled(true);
                    const result = await this.agent.activate(cardKey);
                    button.setDisabled(false);
                    if (input) input.value = "";
                    new Notice(result.message);
                    if (result.ok) this.render();
                })
            );
        const input = setting.controlEl.createEl("input", {
            type: "password",
            placeholder: "输入新的卡密",
            attr: { autocomplete: "off", autocapitalize: "none", spellcheck: "false" },
        });
        input.addClass("ai-account-input");
    }

    /** 邮箱账户入口：显示登录/绑定状态，点击只打开邮箱界面。 */
    private renderEmailEntry(contentEl: HTMLElement): void {
        new Setting(contentEl)
            .setName("邮箱账户")
            .setDesc(describeEmailEntryStatus(this.agent.emailAccount))
            .addButton((button) => button
                .setButtonText("打开")
                .setIcon("log-in")
                .setCta()
                .onClick(() => this.openAccountSection("email")));
    }

    /**
     * 独立同步空间（Pro）入口：显示是否开通/只读/用量，点击只打开 Pro 界面。
     *
     * 已激活且尚未读过状态时做一次**只读 GET** 回显；入口本身绝不切换同步空间。
     */
    private renderProNamespaceEntry(contentEl: HTMLElement): void {
        const activated = get(this.agent.state).activated;
        const setting = new Setting(contentEl)
            .setName("独立同步空间（Pro）")
            .setDesc(activated
                ? describeProNamespaceEntryStatus(this.agent.proNamespace)
                : "激活账户后可查看 Pro 专属空间")
            .addButton((button) => button
                .setButtonText("打开")
                .setIcon("database")
                .onClick(() => this.openAccountSection("pro")));
        if (!activated || this.agent.proNamespace || this.proStatusRequested) return;
        this.proStatusRequested = true;
        void this.agent.proNamespaceStatus().then(() => {
            if (setting.settingEl.isConnected) {
                setting.setDesc(describeProNamespaceEntryStatus(this.agent.proNamespace));
            }
        });
    }

    /**
     * 打开共享的账户区块界面（邮箱 / Pro）。
     *
     * 与账户详情、设置弹窗一样先收起工具中心，避免弹窗叠加；入口不做任何登录
     * 或开通动作。
     */
    private openAccountSection(kind: OsycAccountSectionKind): void {
        this.close();
        try {
            new OsycAccountSectionModal(this.app, this.agent, kind).open();
        } catch (error) {
            console.error("打开账户设置界面失败", error);
            new Notice("无法打开账户设置界面");
        }
    }

    private renderRecharge(contentEl: HTMLElement): void {
        const setting = new Setting(contentEl)
            .setName("充值卡密")
            .setDesc("充值后，积分和有效期会与账户同步更新。");
        const input = setting.controlEl.createEl("input", {
            type: "password",
            placeholder: "输入卡密",
            attr: { autocomplete: "off", autocapitalize: "none", spellcheck: "false" },
        });
        input.addClass("ai-tools-recharge-input");
        setting.addButton((button) => button.setButtonText(this.recharging ? "处理中…" : "确认充值").setIcon("credit-card").setCta().setDisabled(this.recharging).onClick(async () => {
            const cardKey = input.value.trim();
            if (!cardKey || this.recharging) return;
            this.recharging = true;
            this.render();
            const result = await this.agent.recharge(cardKey);
            this.recharging = false;
            if (result.ok) input.value = "";
            new Notice(result.message);
            this.render();
        }));
    }

    private renderDebug(contentEl: HTMLElement): void {
        const runtime = this.agent.runtimeInfo;
        contentEl.createEl("p", { text: "此处只显示脱敏的运行状态和日志。", cls: "setting-item-description" });
        new Setting(contentEl).setName("进行中的任务").setDesc(String(get(this.agent.tasks).filter((task) => task.status === "queued" || task.status === "running").length));
        new Setting(contentEl).setName("服务端版本").setDesc(runtime?.backend_release_id ?? "尚未获取");
        new Setting(contentEl).setName("流式协议").setDesc(runtime?.streaming_protocol_version ?? "尚未获取");
        new Setting(contentEl)
            .setName("复制脱敏诊断")
            .setDesc("包含版本、平台和安全运行状态，不包含 Vault 原文、卡密或 API 密钥。")
            .addButton((button) => button.setButtonText("复制").setIcon("copy").onClick(() => void this.copyDiagnostics()));
        new Setting(contentEl)
            .setName("复制 OsyC 日志")
            .setDesc("用于在问题反馈中附上已脱敏的 OsyC 日志。")
            .addButton((button) => button.setButtonText("复制").setIcon("copy").onClick(() => void this.copyLogs()));
        new Setting(contentEl)
            .setName("上传脱敏诊断")
            .setDesc("上传版本、平台、账户档位、LiveSync 摘要、最近日志与 API 失败摘要；不含 Vault 原文、卡密、token 或完整 setup URI。")
            .addButton((button) =>
                button
                    .setButtonText(this.uploadingDiagnostics ? "上传中…" : "上传")
                    .setIcon("send")
                    .setDisabled(this.uploadingDiagnostics)
                    .onClick(async () => {
                        if (this.uploadingDiagnostics) return;
                        if (!this.uploadDiagnostics) {
                            new Notice("当前版本未接入诊断上传");
                            return;
                        }
                        this.uploadingDiagnostics = true;
                        this.render();
                        const result = await this.uploadDiagnostics(createManualDiagnosticTask());
                        this.uploadingDiagnostics = false;
                        new Notice(result.message);
                        this.render();
                    })
            );
    }

    private async copyDiagnostics(): Promise<void> {
        const state = get(this.agent.state);
        const report = JSON.stringify({
            runtime: this.agent.runtimeInfo ?? null,
            status: { activated: state.activated, plan: state.plan, taskCount: get(this.agent.tasks).length },
        }, null, 2);
        try {
            await navigator.clipboard.writeText(report);
            new Notice("脱敏诊断已复制");
        } catch {
            new Notice("复制失败，请检查系统剪贴板权限");
        }
    }

    private async copyLogs(): Promise<void> {
        try {
            await navigator.clipboard.writeText(osycLogger.report());
            new Notice("OsyC 日志已复制");
        } catch {
            new Notice("复制失败，请在命令面板打开 OsyC 日志");
        }
    }
}
