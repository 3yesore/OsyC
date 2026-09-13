import { describe, expect, it } from "vitest";
import {
    DEFAULT_APPEARANCE,
    FONT_SOURCE_GROUPS,
    FONT_SOURCE_LABELS,
    fontOptionsForSources,
    appearanceToCssVariables,
    appearanceToCssText,
    parseAppearance,
    type AppearanceSettings,
} from "./appearance";

describe("OsyC Agent appearance", () => {
    it("provides theme-following defaults", () => {
        expect(DEFAULT_APPEARANCE.version).toBe(1);
        expect(DEFAULT_APPEARANCE.fontSize).toBeNull();
        expect(DEFAULT_APPEARANCE.codeFontSource).toBe("system-mono");
        expect(DEFAULT_APPEARANCE.background.mode).toBe("theme");
        expect(DEFAULT_APPEARANCE.density).toBe("comfortable");
    });

    it("clamps values and drops unknown fields", () => {
        const parsed = parseAppearance({
            version: 999,
            fontSize: 99,
            lineHeight: 0.1,
            density: "invalid",
            unknown: "must-not-survive",
            background: { mode: "image", opacity: 4, vaultPath: "../secret.png" },
        });
        expect(parsed.fontSize).toBe(24);
        expect(parsed.lineHeight).toBe(1.3);
        expect(parsed.density).toBe("comfortable");
        expect("unknown" in parsed).toBe(false);
        expect(parsed.background.opacity).toBe(1);
        expect(parsed.background.vaultPath).toBeNull();
    });

    it("emits only local OsyC CSS variables", () => {
        const settings: AppearanceSettings = {
            ...DEFAULT_APPEARANCE,
            fontSize: 18,
            fontSource: "system-sans",
            colourOverrides: { text: "#123456", accent: "javascript:bad" },
            background: {
                ...DEFAULT_APPEARANCE.background,
                mode: "image",
                vaultPath: "assets/bg.png",
            },
        };
        const vars = appearanceToCssVariables(settings, "app://local/assets/bg.png", "dark");
        expect(vars["--osyc-ai-font-size"]).toBe("18px");
        expect(vars["--osyc-ai-font-family"]).toContain("system-ui");
        expect(vars["--osyc-ai-text"]).toBe("#123456");
        expect(vars["--osyc-ai-accent"]).toBeUndefined();
        expect(vars["--osyc-ai-background-image"]).toContain("app://local/assets/bg.png");
        expect(Object.keys(vars).every((key) => key.startsWith("--osyc-ai-"))).toBe(true);
    });

    it("uses a readable dark palette instead of dark text on a dark preview", () => {
        const vars = appearanceToCssVariables({ ...DEFAULT_APPEARANCE, colourPreset: "ocean" }, undefined, "dark");
        expect(vars["--osyc-ai-text"]).toBe("#e6f4ff");
        expect(vars["--osyc-ai-surface"]).toBe("#152733");
    });

    it("offers broad Chinese, Latin, and code font choices without remote resources", () => {
        expect(Object.keys(FONT_SOURCE_LABELS).length).toBeGreaterThanOrEqual(26);
        expect(FONT_SOURCE_LABELS["pingfang"]).toContain("苹方");
        expect(FONT_SOURCE_LABELS["source-han-serif"]).toContain("思源宋体");
        expect(FONT_SOURCE_LABELS["mi-sans"]).toContain("MiSans");
        expect(FONT_SOURCE_LABELS["sarasa-gothic"]).toContain("更纱");
        expect(FONT_SOURCE_LABELS["jetbrains-mono"]).toContain("JetBrains");
        expect(FONT_SOURCE_LABELS["maple-mono"]).toContain("Maple");
        const vars = appearanceToCssVariables({ ...DEFAULT_APPEARANCE, fontSource: "source-han-serif" });
        expect(vars["--osyc-ai-font-family"]).toContain("Source Han Serif SC");
        expect(vars["--osyc-ai-font-family"]).not.toContain("url(");
    });

    it("keeps body and code font catalogs separated", () => {
        const body = fontOptionsForSources([
            ...FONT_SOURCE_GROUPS.chineseSans,
            ...FONT_SOURCE_GROUPS.chineseSerif,
            ...FONT_SOURCE_GROUPS.system,
        ]);
        const code = fontOptionsForSources(FONT_SOURCE_GROUPS.code);
        expect(body["jetbrains-mono"]).toBeUndefined();
        expect(body.pingfang).toContain("苹方");
        expect(code["jetbrains-mono"]).toContain("JetBrains");
        expect(code["source-han-serif"]).toBeUndefined();
    });

    it("falls back safely when an unknown font source is loaded from old settings", () => {
        const parsed = parseAppearance({ fontSource: "not-a-font", headingFontSource: "also-not-a-font", codeFontSource: "missing-code-font" });
        expect(parsed.fontSource).toBe("obsidian");
        expect(parsed.headingFontSource).toBe("same");
        expect(parsed.codeFontSource).toBe("system-mono");
    });

    it("targets Obsidian note reading, live preview, and source content", () => {
        const css = appearanceToCssText({ ...DEFAULT_APPEARANCE, fontSize: 20 });
        expect(css).toContain(".markdown-reading-view");
        expect(css).toContain(".markdown-preview-view");
        expect(css).toContain(".markdown-source-view .cm-content");
        expect(css).toContain("font-size: var(--osyc-ai-font-size)");
        expect(css).toContain("background-color: var(--osyc-ai-note-background)");
    });

    it("applies the selected heading font to Obsidian's inline file title", () => {
        const css = appearanceToCssText({ ...DEFAULT_APPEARANCE, headingFontSource: "lxgw-wenkai" });
        expect(css).toContain(".markdown-reading-view .inline-title");
        expect(css).toContain(".markdown-preview-view .inline-title");
        expect(css).toContain("font-family: var(--osyc-ai-note-heading-font-family) !important");
    });

    it("does not emit note selectors when note styling is disabled", () => {
        const css = appearanceToCssText({
            ...DEFAULT_APPEARANCE,
            applyToNotes: false,
            fontSize: 22,
            colourPreset: "ocean",
            colourOverrides: { text: "#ff00ff" },
            background: { ...DEFAULT_APPEARANCE.background, mode: "solid", solidColor: "#123456" },
        });
        expect(css).not.toContain(".markdown-reading-view");
        expect(css).toContain(".osyc-ai-agent");
        expect(css).not.toContain("22px");
        expect(css).not.toContain("#ff00ff");
        expect(css).not.toContain("#123456");
    });

    it("消费标题比例和长文本策略，而不是只输出未使用 token", () => {
        const css = appearanceToCssText({
            ...DEFAULT_APPEARANCE,
            headingScale: 1.3,
            longTextStrategy: "code-scroll",
        });
        expect(css).toContain("font-size: calc(var(--osyc-ai-note-font-size) * var(--osyc-ai-heading-scale))");
        expect(css).toContain("font-family: var(--osyc-ai-code-font-family)");
        expect(css).toContain("overflow-x: auto");
    });

    it("覆盖 Markdown 内容块的表面、边框和代码文字，而不是留下 Obsidian 默认白底", () => {
        const css = appearanceToCssText({ ...DEFAULT_APPEARANCE, colourPreset: "graphite" });
        expect(css).toContain("--osyc-ai-note-code-background");
        expect(css).toContain(".markdown-reading-view pre");
        expect(css).toContain(".markdown-preview-view pre");
        expect(css).toContain("background-color: var(--osyc-ai-note-code-background)");
        expect(css).toContain(".markdown-reading-view blockquote");
        expect(css).toContain(".markdown-reading-view table");
        expect(css).toContain(".markdown-reading-view .callout");
        expect(css).toContain("!important");
    });

    it("将背景图片变量传递给内容块和预览，而不是只保留路径配置", () => {
        const css = appearanceToCssText({
            ...DEFAULT_APPEARANCE,
            background: { ...DEFAULT_APPEARANCE.background, mode: "image", vaultPath: "assets/paper.png" },
        }, "app://local/assets/paper.png");
        expect(css).toContain('--osyc-ai-note-background-image: url("app://local/assets/paper.png")');
        expect(css).toContain("background-image: var(--osyc-ai-note-background-image)");
    });

    it("覆盖 Obsidian 实际的 rendered、live-preview 和动态代码块节点", () => {
        const css = appearanceToCssText({ ...DEFAULT_APPEARANCE, colourPreset: "graphite" });
        expect(css).toContain(".markdown-rendered");
        expect(css).toContain(".markdown-source-view.mod-cm6 .cm-content");
        expect(css).toContain(".markdown-preview-view pre");
        expect(css).toContain("--code-background: var(--osyc-ai-note-code-background)");
    });

    it("为背景图片输出可见的独立背景层并消费透明度", () => {
        const css = appearanceToCssText({
            ...DEFAULT_APPEARANCE,
            background: { ...DEFAULT_APPEARANCE.background, mode: "image", vaultPath: "assets/paper.png", opacity: 0.35 },
        }, "app://local/assets/paper.png");
        expect(css).toContain("::before");
        expect(css).toContain("opacity: var(--osyc-ai-background-opacity)");
        expect(css).toContain("z-index: -1");
    });

    it("将 OsyC 预设 token 映射到 Agent 子区域", () => {
        const css = appearanceToCssText({ ...DEFAULT_APPEARANCE, colourPreset: "graphite" });
        expect(css).toContain(".osyc-ai-agent .ai-chat");
        expect(css).toContain("background-color: var(--osyc-ai-surface)");
        expect(css).toContain(".osyc-ai-agent .ai-composer");
        expect(css).toContain("color: var(--osyc-ai-text)");
    });

    it("将任务卡、状态横幅和确认区也映射到 OsyC 预设 token", () => {
        const css = appearanceToCssText({ ...DEFAULT_APPEARANCE, colourPreset: "graphite" });
        expect(css).toContain(".osyc-ai-agent .ai-task-card");
        expect(css).toContain(".osyc-ai-agent .ai-banner");
        expect(css).toContain(".osyc-ai-agent .ai-confirmation");
        expect(css).toContain("background: var(--osyc-ai-surface-alt) !important");
        expect(css).toContain("color: var(--osyc-ai-error) !important");
    });

    it("uses the loaded local font family for custom sources", () => {
        const vars = appearanceToCssVariables({ ...DEFAULT_APPEARANCE, fontSource: "custom:demo" }, undefined, "light", [{ id: "demo", family: "Demo Font" }]);
        expect(vars["--osyc-ai-font-family"]).toContain("Demo Font");
        expect(vars["--osyc-ai-font-family"]).not.toContain("custom:");
    });

    it("supports curated open-source-inspired presets with distinct note tokens", () => {
        const minimal = appearanceToCssVariables({ ...DEFAULT_APPEARANCE, colourPreset: "minimal" });
        const chinese = appearanceToCssVariables({ ...DEFAULT_APPEARANCE, colourPreset: "chinese-writing" });
        const code = appearanceToCssVariables({ ...DEFAULT_APPEARANCE, colourPreset: "codesplash" });
        expect(minimal["--osyc-ai-surface"]).not.toBe(chinese["--osyc-ai-surface"]);
        expect(chinese["--osyc-ai-font-family"]).toContain("LXGW");
        expect(code["--osyc-ai-code-font-family"]).toContain("JetBrains");
    });

    it("resolves bundled preset typography from the selected appearance preset", () => {
        const settings = { ...DEFAULT_APPEARANCE, preset: "chinese-writing" as const, colourPreset: "theme" as const };
        const vars = appearanceToCssVariables(settings);
        expect(vars["--osyc-ai-font-family"]).toContain("LXGW");
    });

    it("uses the exact family names shipped in the plugin bundle", () => {
        const vars = appearanceToCssVariables({ ...DEFAULT_APPEARANCE, fontSource: "noto-sans" });
        expect(vars["--osyc-ai-font-family"]).toContain('"Noto Sans SC"');
    });

    it("parses bundled theme pack selection and rejects unknown pack ids", () => {
        const parsed = parseAppearance({ themePackId: "minimal-original", themePackScope: "workspace" });
        expect(parsed.themePackId).toBe("minimal-original");
        expect(parsed.themePackScope).toBe("workspace");
        expect(parseAppearance({ themePackId: "remote-theme", themePackScope: "workspace" }).themePackId).toBeNull();
    });
});
