import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./OsycSettingsModal.ts", import.meta.url)), "utf8");
const paneSource = readFileSync(fileURLToPath(new URL("./osycSettingsPane.ts", import.meta.url)), "utf8");
const toolsSource = readFileSync(fileURLToPath(new URL("./AIAgentToolsModal.ts", import.meta.url)), "utf8");
const accountSource = readFileSync(
    fileURLToPath(new URL("./AIAgentAccountModal.ts", import.meta.url)),
    "utf8"
);
const moduleSource = readFileSync(
    fileURLToPath(new URL("../../../modules/features/ModuleObsidianSettingTab.ts", import.meta.url)),
    "utf8"
);

describe("OsycSettingsModal", () => {
    it("is an Obsidian native modal that renders the shared settings page", () => {
        expect(source).toContain("export class OsycSettingsModal extends Modal");
        expect(source).toContain("renderOsycSettingsPanes(contentEl");
        expect(source).toContain('this.titleEl.setText("OsyC 设置")');
        // 复用原生设置页的排版基线，否则弹窗里的 Setting 行与移动端控件尺寸会走另一套。
        expect(source).toContain('contentEl.addClass("sls-setting")');
    });

    it("keeps one rendering path so the modal and the native page cannot diverge", () => {
        expect(paneSource).toContain("export function renderOsycSettingsPanes(");
        // 弹窗不得自己再实现一份设置项渲染；两套界面各存一份状态正是上一版被删除的原因。
        expect(source).not.toContain("appearanceToCssVariables");
        expect(source).not.toContain("controller.setServiceUrl");
        expect(source).not.toContain("getOsycSettingsController");
    });

    it("routes every in-plugin settings entry through the modal", () => {
        for (const file of [toolsSource, accountSource, moduleSource]) {
            expect(file).toContain("openOsycSettings(this.app)");
            expect(file).not.toContain("openObsidianSettings");
        }
    });

    it("keeps the LiveSync-only configuration reachable behind an explicit label", () => {
        // 远端地址与口令属于 LiveSync，弹窗里放不下，只能明确标注后跳转原生设置。
        expect(source).toContain('setName("同步配置（LiveSync）")');
        expect(source).toContain("openObsidianSettings(this.app, CURRENT_PLUGIN_ID)");
    });

    it("does not keep a second settings state", () => {
        // 弹窗自身不持有任何偏好：读写全部经 OsycSettingsController 回到运行时。
        expect(source).not.toContain("let settings");
        expect(source).not.toContain("loadData");
        expect(source).not.toContain("saveData");
    });
});
