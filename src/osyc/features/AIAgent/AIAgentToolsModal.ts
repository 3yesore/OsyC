import { Modal, Notice, Setting, type App } from "@/deps.ts";
import { get } from "svelte/store";
import { openObsidianSettings } from "@/common/obsidianSettings.ts";
import { CURRENT_PLUGIN_ID } from "@/osyc/migration/pluginIdentity";
import type { CmdAIAgent } from "./CmdAIAgent";
import { osycLogger } from "@/osyc/serviceFeatures/osycLogger";

type ToolsTab = "account" | "recharge" | "debug";

const TAB_LABEL: Record<ToolsTab, string> = {
    account: "账户与权益",
    recharge: "充值",
    debug: "调试",
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

    constructor(
        app: App,
        private agent: CmdAIAgent,
        private openAccountDetails: () => void,
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
                text: TAB_LABEL[tab],
                attr: {
                    type: "button",
                    role: "tab",
                    "aria-selected": String(this.tab === tab),
                    "data-osyc-tools-tab": tab,
                },
            });
            button.toggleClass("is-active", this.tab === tab);
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
        new Setting(contentEl).setName("当前权益").setDesc(PLAN_LABEL[state.plan] ?? state.plan);
        new Setting(contentEl).setName("剩余积分").setDesc(`${state.credits} 分`);
        new Setting(contentEl).setName("到期时间").setDesc(
            state.expireAt ? new Date(state.expireAt).toLocaleDateString("zh-CN") : "—"
        );
        contentEl.createEl("h3", { text: "权益总览", cls: "ai-tools-section" });
        if (state.entitlements) {
            new Setting(contentEl).setName("OC 整理任务").setDesc(state.entitlements.aiTasks ? "已开通" : "未开通");
            new Setting(contentEl).setName("私有同步").setDesc(state.entitlements.sync ? "已开通" : "未开通");
            new Setting(contentEl).setName("Cloud-Vault").setDesc(
                state.entitlements.cloudVault ? `已开通（${state.entitlements.cloudQuotaMb || 0} MB）` : "未开通"
            );
        } else {
            contentEl.createEl("p", { text: "权益信息将在账户刷新后显示。", cls: "setting-item-description" });
        }
        if (state.cloudVault.available) {
            new Setting(contentEl)
                .setName("Cloud-Vault 备份")
                .setDesc(state.cloudVault.snapshots.length > 0 ? `已有 ${state.cloudVault.snapshots.length} 个快照` : "尚无备份快照")
                .addButton((button) => button.setButtonText("立即备份").onClick(async () => {
                    button.setDisabled(true);
                    const result = await this.agent.cloudBackup();
                    button.setDisabled(false);
                    new Notice(result.message);
                    if (result.ok) this.render();
                }));
        }
        new Setting(contentEl)
            .setName("账户详情")
            .setDesc("查看设备、同步状态，以及邮箱登录预览。")
            .addButton((button) => button.setButtonText("打开详情").onClick(() => {
                this.close();
                this.openAccountDetails();
            }));
        new Setting(contentEl)
            .setName("OsyC 设置")
            .setDesc("在 Obsidian 原生设置中配置 OsyC。")
            .addButton((button) => button.setButtonText("打开设置").setCta().onClick(() => {
                try {
                    openObsidianSettings(this.app, CURRENT_PLUGIN_ID);
                    this.close();
                } catch (error) {
                    console.error("打开 OsyC 设置失败", error);
                    new Notice("无法打开 OsyC 设置");
                }
            }));
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
        setting.addButton((button) => button.setButtonText(this.recharging ? "处理中…" : "确认充值").setCta().setDisabled(this.recharging).onClick(async () => {
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
            .addButton((button) => button.setButtonText("复制").onClick(() => void this.copyDiagnostics()));
        new Setting(contentEl)
            .setName("复制 OsyC 日志")
            .setDesc("用于在问题反馈中附上已脱敏的 OsyC 日志。")
            .addButton((button) => button.setButtonText("复制").onClick(() => void this.copyLogs()));
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
