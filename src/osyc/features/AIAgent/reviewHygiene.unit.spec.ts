import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (name: string): string => readFileSync(resolve(import.meta.dirname, name), "utf8");

describe("Obsidian review hygiene", () => {
    it("uses the active window crypto API for note hashing", () => {
        const source = readSource("activeNoteContext.ts");
        expect(source).not.toContain("globalThis");
        expect(source).toContain("window.crypto");
    });

    it("uses Obsidian DOM helpers in the account modal", () => {
        const source = readSource("AIAgentAccountModal.ts");
        expect(source).not.toMatch(/createEl\(\"div\"/);
        expect(source).not.toMatch(/createEl\(\"span\"/);
        expect(source).not.toMatch(/\) as HTMLInputElement/);
    });

    it("uses the supported encryption capability check", () => {
        const source = readFileSync(
            resolve(import.meta.dirname, "../../../modules/features/SettingDialogue/ObsidianLiveSyncSettingTab.ts"),
            "utf8"
        );
        expect(source).not.toContain("testCrypt");
        expect(source).toContain("testEncryptionFeature");
    });

    it("does not trust untyped JSON response values", () => {
        const source = readSource("CmdAIAgent.ts");
        expect(source).not.toMatch(/const data = await res\.json;/);
    });

    // Unicode pictographs used as stand-in icons render differently depending on
    // the platform font and ignore the theme colour, which is exactly what made
    // the phone UI unpredictable. Obsidian's own icon set is the reliable option.
    // CJK punctuation (，：；？（）) and the ⌘ key symbol are typography and stay.
    const ICON_GLYPH =
        /[\u2190-\u21FF\u22EF\u2300-\u2317\u2319-\u23FF\u25A0-\u27BF\u2B00-\u2BFF\uFF0B\u{1F000}-\u{1FAFF}]/u;

    // 所有对外可见的 OsyC 界面：对话页、助手气泡、工具中心、账户、公告、原生设置页。
    const OSYC_ICON_SURFACES = [
        "AIAgentPane.svelte",
        "AIAgentAssistantMessage.svelte",
        "AIAgentToolsModal.ts",
        "AIAgentAccountModal.ts",
        "AnnouncementModal.ts",
        "osycSettingsPane.ts",
        // 设置弹窗把原生设置页的整体渲染承载过来，自己只画一个图标（settings）。
        "OsycSettingsModal.ts",
    ];

    // 设置页要额外豁免：`addPane(name, emoji, order)` 的 emoji 是 LiveSync 全插件通用的
    // 分组标题约定（每个 pane 标题都带 emoji），不属于 OsyC 自造的按钮图标，不能单独改。
    const OSYC_GLYPH_FREE_SURFACES = OSYC_ICON_SURFACES.filter((name) => name !== "osycSettingsPane.ts");

    // 逐个比对过本机 Obsidian 1.13.7 内置图标表（1994 个 id）之后确认存在的子集。
    // Obsidian 遇到未知图标名不会报错，只是静默渲染成空白，只有真机上才看得出来，
    // 因此用白名单把拼写错误挡在提交之前。
    const OSYC_ICON_VOCABULARY = new Set([
        "alert-triangle",
        "arrow-up",
        "bell",
        "check",
        "clock",
        "copy",
        "credit-card",
        "database",
        "download",
        "file-text",
        "home",
        "info",
        "key",
        "loader",
        "log-out",
        "menu",
        "panel-left",
        "pause",
        "plus",
        "refresh-cw",
        "rotate-ccw",
        "settings",
        "sparkles",
        "trash-2",
        "user",
        "wrench",
        "x",
    ]);

    /** 取出一个文件里用到的全部图标名：命令式 setIcon、组件式 OsycIcon、以及状态图标走查表。 */
    function iconNamesIn(source: string): string[] {
        const names = new Set<string>();
        for (const match of source.matchAll(/setIcon\(\s*"([a-z0-9-]+)"\s*\)/g)) names.add(match[1]);
        for (const match of source.matchAll(/<OsycIcon[^>]*?\sname="([a-z0-9-]+)"/g)) names.add(match[1]);
        const statusMap = /SESSION_STATUS_ICON[^=]*=\s*\{(.*?)\n {4}\};/s.exec(source);
        if (statusMap) {
            for (const match of statusMap[1].matchAll(/:\s*"([a-z0-9-]+)"/g)) names.add(match[1]);
        }
        return [...names].sort();
    }

    it("renders every OsyC surface icon through Obsidian instead of Unicode glyphs", () => {
        for (const name of OSYC_ICON_SURFACES) {
            expect(`icons in ${name}: ${iconNamesIn(readSource(name)).length > 0}`).toBe(`icons in ${name}: true`);
        }
        for (const name of OSYC_GLYPH_FREE_SURFACES) {
            const found = readSource(name).match(ICON_GLYPH);
            expect(`glyph in ${name}: ${found?.[0] ?? "none"}`).toBe(`glyph in ${name}: none`);
        }
        expect(readSource("OsycIcon.svelte")).toContain("setIcon");
    });

    it("keeps every icon name inside the reviewed Obsidian icon vocabulary", () => {
        const unknown: string[] = [];
        for (const name of OSYC_ICON_SURFACES) {
            for (const icon of iconNamesIn(readSource(name))) {
                if (!OSYC_ICON_VOCABULARY.has(icon)) unknown.push(`${name} -> ${icon}`);
            }
        }
        expect(unknown).toEqual([]);
    });

    it("wires the session list status icons to one reviewed name per lifecycle state", () => {
        const statusMap = /SESSION_STATUS_ICON[^=]*=\s*\{(.*?)\n {4}\};/s.exec(readSource("AIAgentPane.svelte"));
        const entries = [...(statusMap?.[1] ?? "").matchAll(/^\s+(\w+): "([a-z0-9-]+)",$/gm)].map((match) => [
            match[1],
            match[2],
        ]);
        expect(entries.map(([status]) => status)).toEqual([
            "queued",
            "running",
            "done",
            "failed",
            "awaiting_confirmation",
            "conflict",
            "interrupted",
            "failed_zero_cost",
            "delivery_failed",
            "cancelled",
        ]);
        for (const [, icon] of entries) expect(OSYC_ICON_VOCABULARY.has(icon)).toBe(true);
    });
});
