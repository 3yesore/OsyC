import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE } from "@/osyc/features/AIAgent/appearance";
import {
    THEME_PROFILE_VERSION,
    migrateAppearanceToThemeProfile,
    parseThemeProfile,
    themeProfileToCssVariables,
    themeProfileToScopedCss,
} from "./themeModel";

describe("OsyC theme profile", () => {
    it("migrates the existing appearance profile without losing note controls", () => {
        const profile = migrateAppearanceToThemeProfile({
            ...DEFAULT_APPEARANCE,
            fontSize: 19,
            headingScale: 1.3,
            contentWidth: 720,
            background: { ...DEFAULT_APPEARANCE.background, mode: "solid", solidColor: "#123456" },
        });
        expect(profile.version).toBe(THEME_PROFILE_VERSION);
        expect(profile.typography.fontSize).toBe(19);
        expect(profile.typography.headingScale).toBe(1.3);
        expect(profile.layout.contentWidth).toBe(720);
        expect(profile.background.mode).toBe("solid");
        expect(profile.background.solidColor).toBe("#123456");
    });

    it("cleans invalid v2 values and keeps a safe default", () => {
        const parsed = parseThemeProfile({
            version: 2,
            typography: { fontSize: 99, lineHeight: 0.2, firstLineIndent: 20 },
            layout: { contentWidth: 1200, imageLayout: "masonry" },
            colours: { text: "javascript:bad", accent: "#0af" },
        });
        expect(parsed.typography.fontSize).toBe(24);
        expect(parsed.typography.lineHeight).toBe(1.3);
        expect(parsed.typography.firstLineIndent).toBe(2);
        expect(parsed.layout.contentWidth).toBe(960);
        expect(parsed.layout.imageLayout).toBe("single");
        expect(parsed.colours.text).toBeUndefined();
        expect(parsed.colours.accent).toBe("#0af");
    });

    it("emits only OsyC-prefixed variables and scoped Markdown selectors", () => {
        const profile = migrateAppearanceToThemeProfile({ ...DEFAULT_APPEARANCE, fontSize: 18 });
        const vars = themeProfileToCssVariables(profile);
        expect(Object.keys(vars).every((key) => key.startsWith("--osyc-ai-"))).toBe(true);
        const css = themeProfileToScopedCss(profile);
        expect(css).toContain(".osyc-theme-notes .markdown-reading-view");
        expect(css).toContain(".osyc-theme-notes .markdown-preview-view");
        expect(css).not.toMatch(/(?:^|\n)\s*(body|\.workspace|\.app-container)\b/);
        expect(css).not.toContain("@import");
        expect(css).not.toContain("url(http");
    });

    it("keeps the selected heading font available to file titles in every note layout", () => {
        const profile = migrateAppearanceToThemeProfile({
            ...DEFAULT_APPEARANCE,
            fontSource: "source-han-serif",
            headingFontSource: "lxgw-wenkai",
        });
        const css = themeProfileToScopedCss(profile);
        expect(css).toContain("--osyc-ai-note-heading-font-family:");
        expect(css).toContain('.osyc-theme-notes .inline-title');
        expect(css).toContain('font-family: var(--osyc-ai-note-heading-font-family) !important');
        expect(css).not.toContain('.markdown-reading-view .osyc-theme-notes .markdown-preview-sizer');
    });

    it("keeps the colour preset independent from the typography preset", () => {
        // Regression: toAppearance() wrote `preset` into `colourPreset`, so picking
        // a typography preset (chinese-writing, codex, …) silently applied that
        // preset's hard-coded palette and the chat surface stopped following the
        // Obsidian theme — the "different UI baseline" users reported.
        const typographyOnly = migrateAppearanceToThemeProfile({
            ...DEFAULT_APPEARANCE,
            preset: "chinese-writing",
            colourPreset: "theme",
        });
        expect(typographyOnly.colourPreset).toBe("theme");
        // No palette override is emitted, so the chat surface keeps the theme colours.
        expect(themeProfileToCssVariables(typographyOnly)["--osyc-ai-text"]).toBeUndefined();

        const coloured = migrateAppearanceToThemeProfile({
            ...DEFAULT_APPEARANCE,
            preset: "chinese-writing",
            colourPreset: "chinese-writing",
        });
        expect(coloured.colourPreset).toBe("chinese-writing");
        expect(themeProfileToCssVariables(coloured)["--osyc-ai-text"]).toBe("#332c27");
    });

    it("keeps the palette of profiles written before the colour split", () => {
        // v2 profiles carry no `colourPreset`; they must keep resolving colours
        // from `preset` so an existing user's appearance does not change.
        const legacy = parseThemeProfile({
            version: 2,
            preset: "graphite",
            typography: {},
            layout: {},
            colours: {},
        });
        expect(themeProfileToCssVariables(legacy)["--osyc-ai-surface"]).toBe("#202326");
    });

    it("bridges original theme typography variables to the active OsyC font", () => {
        const profile = migrateAppearanceToThemeProfile({
            ...DEFAULT_APPEARANCE,
            preset: "chinese-writing",
            fontSource: "noto-sans",
            headingFontSource: "same",
        });
        const css = themeProfileToScopedCss(profile);
        expect(css).toContain("--cw-font-family: var(--osyc-ai-note-font-family)");
        expect(css).toContain("--cw-heading-font-family: var(--osyc-ai-note-heading-font-family)");
        expect(css).toContain("--font-text: var(--osyc-ai-note-font-family)");
    });
});
