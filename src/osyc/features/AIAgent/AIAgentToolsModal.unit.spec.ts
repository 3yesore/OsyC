import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(
    fileURLToPath(new URL("./AIAgentToolsModal.ts", import.meta.url)),
    "utf8"
);
const paneSource = readFileSync(
    fileURLToPath(new URL("./AIAgentPane.svelte", import.meta.url)),
    "utf8"
);
const uiSource = readFileSync(
    fileURLToPath(new URL("../../serviceFeatures/useAIAgentUI.ts", import.meta.url)),
    "utf8"
);

describe("AIAgentToolsModal", () => {
    it("uses Obsidian native controls for the unified tools centre", () => {
        expect(source).toContain('import { Modal, Notice, Setting, setIcon, type App } from "@/deps.ts"');
        expect(source).toContain("export class AIAgentToolsModal extends Modal");
        expect(source).toContain('"data-osyc-tools-tab": tab');
        expect(source).toContain('account: "账户"');
        expect(source).toContain('recharge: "充值"');
        expect(source).toContain('debug: "调试"');
    });

    it("renders tab and action icons from the Obsidian icon set", () => {
        expect(source).toContain("TAB_ICON");
        expect(source).toContain('setIcon(button.createSpan({ cls: "ai-tools-tab-icon" }), TAB_ICON[tab])');
        expect(source).toContain('button.createSpan({ cls: "ai-tools-tab-label", text: TAB_LABEL[tab] })');
        // Buttons carry their icon through the native control, not a glyph.
        expect(source).toContain('.setIcon("copy")');
    });

    it("opens the shared OsyC settings modal and makes recharge state explicit", () => {
        expect(source).toContain("openOsycSettings(this.app)");
        expect(source).toContain("this.recharging");
        expect(source).toContain("await this.agent.recharge");
        expect(source).toContain("new Notice(result.message)");
    });

    it("keeps one settings route and never revives the removed settings modal", () => {
        expect(source).not.toContain("openObsidianSettings");
        expect(uiSource).not.toContain("new AIAgentSettingModal");
        expect(uiSource).not.toContain("演示模式");
    });

    it("keeps diagnostics and modal identity while entitlements live only in the account modal", () => {
        // 分工：权益明细收敛到「我的账户」，工具中心不再重复展示一份
        expect(source).not.toContain("权益总览");
        expect(source).not.toContain("剩余积分");
        expect(source).toContain("复制脱敏诊断");
        expect(source).toContain("复制 OsyC 日志");
        expect(source).toContain("ai-tools-modal");
    });

    it("账户页提供常显的「修复同步配置」与「重新激活卡密」入口（工具中心路径）", () => {
        expect(source).toContain('setName("重新激活卡密")');
        expect(source).toContain('setName("修复同步配置")');
        expect(source).toContain("this.renderReactivation(contentEl)");
        expect(source).toContain("this.renderSyncRepair(contentEl)");
        // 与账户弹窗调用同一个修复函数：一键窄补丁自愈 + 拉取一次。
        expect(source).toContain("control.repairSyncConfiguration()");
        expect(source).toContain("this.agent.activate(cardKey)");
        // 账户页没有默认收起的 details，两个入口必然常显。
        expect(source).not.toContain('createEl("details"');
    });

    it("opens one shared tools centre instead of rendering account actions in chat", () => {
        expect(uiSource).toContain("new AIAgentToolsModal(app, agent");
        expect(paneSource).toContain("onOpenTools");
        expect(paneSource).toContain('data-sidebar-action="tools"');
        expect(paneSource).not.toContain('data-sidebar-action="recharge"');
        expect(paneSource).not.toContain('aria-label="OsyC 调试信息"');
        expect(paneSource).not.toContain('aria-label="私有备份"');
    });
});
