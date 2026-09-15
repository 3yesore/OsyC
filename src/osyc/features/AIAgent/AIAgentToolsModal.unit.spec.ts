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
        expect(source).toContain('import { Modal, Notice, Setting, type App } from "@/deps.ts"');
        expect(source).toContain("export class AIAgentToolsModal extends Modal");
        expect(source).toContain('"data-osyc-tools-tab": tab');
        expect(source).toContain('account: "账户与权益"');
        expect(source).toContain('recharge: "充值"');
        expect(source).toContain('debug: "调试"');
    });

    it("keeps settings in Obsidian and makes recharge state explicit", () => {
        expect(source).toContain('openObsidianSettings(this.app, CURRENT_PLUGIN_ID)');
        expect(source).toContain("this.recharging");
        expect(source).toContain("await this.agent.recharge");
        expect(source).toContain("new Notice(result.message)");
    });

    it("keeps account, diagnostics, and motion behaviour within the modal", () => {
        expect(source).toContain("剩余积分");
        expect(source).toContain("权益总览");
        expect(source).toContain("复制脱敏诊断");
        expect(source).toContain("复制 OsyC 日志");
        expect(source).toContain("ai-tools-modal");
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
