import {
    appearanceToCssText,
    appearanceToCssVariables,
    parseAppearance,
    type AppearanceBackground,
    type AppearanceSettings,
} from "@/osyc/features/AIAgent/appearance";

export const THEME_PROFILE_VERSION = 2 as const;

export interface ThemeTypography {
    fontSource: AppearanceSettings["fontSource"];
    headingFontSource: AppearanceSettings["headingFontSource"];
    codeFontSource: AppearanceSettings["codeFontSource"];
    fontSize: number | null;
    headingScale: number;
    lineHeight: number | null;
    fontWeight: AppearanceSettings["fontWeight"];
    letterSpacing: number;
    paragraphSpacing: number | null;
    firstLineIndent: number;
}

export interface ThemeLayout {
    density: AppearanceSettings["density"];
    contentWidth: number | null;
    longTextStrategy: AppearanceSettings["longTextStrategy"];
    imageLayout: "single" | "grid";
    tableMode: "native" | "scroll";
}

export interface ThemeProfile {
    version: typeof THEME_PROFILE_VERSION;
    applyToNotes: boolean;
    preset: AppearanceSettings["preset"];
    /**
     * Kept separate from the typography `preset` on purpose: the palette is
     * resolved from this field alone, while `preset` also drives fonts and
     * rhythm. Optional because profiles written before the split fall back to
     * `preset` — see {@link toAppearance}.
     */
    colourPreset?: AppearanceSettings["colourPreset"];
    typography: ThemeTypography;
    layout: ThemeLayout;
    colours: Record<string, string>;
    background: AppearanceBackground;
    reducedMotion: AppearanceSettings["reducedMotion"];
    highContrast: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
}

function safeColour(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const colour = value.trim();
    return /^(#[0-9a-f]{3,8}|rgba?\([^)]{1,80}\)|hsla?\([^)]{1,80}\))$/i.test(colour)
        ? colour
        : undefined;
}

function profileFromAppearance(appearance: AppearanceSettings): ThemeProfile {
    return {
        version: THEME_PROFILE_VERSION,
        applyToNotes: appearance.applyToNotes,
        preset: appearance.preset,
        colourPreset: appearance.colourPreset,
        typography: {
            fontSource: appearance.fontSource,
            headingFontSource: appearance.headingFontSource,
            codeFontSource: appearance.codeFontSource,
            fontSize: appearance.fontSize,
            headingScale: appearance.headingScale,
            lineHeight: appearance.lineHeight,
            fontWeight: appearance.fontWeight,
            letterSpacing: appearance.letterSpacing,
            paragraphSpacing: appearance.paragraphSpacing,
            firstLineIndent: 0,
        },
        layout: {
            density: appearance.density,
            contentWidth: appearance.contentWidth,
            longTextStrategy: appearance.longTextStrategy,
            imageLayout: "single",
            tableMode: "scroll",
        },
        colours: Object.fromEntries(
            Object.entries(appearance.colourOverrides).filter((entry): entry is [string, string] => typeof entry[1] === "string")
        ),
        background: { ...appearance.background },
        reducedMotion: appearance.reducedMotion,
        highContrast: appearance.highContrast,
    };
}

export function migrateAppearanceToThemeProfile(value: unknown): ThemeProfile {
    return profileFromAppearance(parseAppearance(value));
}

function toAppearance(profile: ThemeProfile): AppearanceSettings {
    return parseAppearance({
        applyToNotes: profile.applyToNotes,
        preset: profile.preset,
        fontSource: profile.typography.fontSource,
        headingFontSource: profile.typography.headingFontSource,
        codeFontSource: profile.typography.codeFontSource,
        fontSize: profile.typography.fontSize,
        headingScale: profile.typography.headingScale,
        lineHeight: profile.typography.lineHeight,
        fontWeight: profile.typography.fontWeight,
        letterSpacing: profile.typography.letterSpacing,
        density: profile.layout.density,
        contentWidth: profile.layout.contentWidth,
        longTextStrategy: profile.layout.longTextStrategy,
        colourPreset: profile.colourPreset ?? profile.preset,
        colourOverrides: profile.colours,
        background: profile.background,
        reducedMotion: profile.reducedMotion,
        highContrast: profile.highContrast,
    });
}

export function parseThemeProfile(value: unknown): ThemeProfile {
    if (!isRecord(value) || value.version !== THEME_PROFILE_VERSION) return migrateAppearanceToThemeProfile(value);
    const fallback = migrateAppearanceToThemeProfile(undefined);
    const typography = isRecord(value.typography) ? value.typography : {};
    const layout = isRecord(value.layout) ? value.layout : {};
    const colours = isRecord(value.colours)
        ? Object.fromEntries(Object.entries(value.colours).map(([key, colour]) => [key, safeColour(colour)]).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
        : {};
    const parsed = migrateAppearanceToThemeProfile({
        ...fallback,
        applyToNotes: value.applyToNotes,
        preset: value.preset,
        // Absent on profiles written before the split: keep the historical
        // behaviour (palette followed `preset`) instead of resetting to
        // "theme" and silently changing an existing user's colours.
        colourPreset: value.colourPreset ?? value.preset,
        fontSource: typography.fontSource,
        headingFontSource: typography.headingFontSource,
        codeFontSource: typography.codeFontSource,
        fontSize: typography.fontSize,
        headingScale: typography.headingScale,
        lineHeight: typography.lineHeight,
        fontWeight: typography.fontWeight,
        letterSpacing: typography.letterSpacing,
        density: layout.density,
        contentWidth: layout.contentWidth,
        longTextStrategy: layout.longTextStrategy,
        colourOverrides: colours,
        background: value.background,
        reducedMotion: value.reducedMotion,
        highContrast: value.highContrast,
    });
    parsed.typography.firstLineIndent = clamp(typography.firstLineIndent, 0, 2, 0);
    parsed.layout.imageLayout = layout.imageLayout === "grid" ? "grid" : "single";
    parsed.layout.tableMode = layout.tableMode === "native" ? "native" : "scroll";
    return parsed;
}

export function themeProfileToCssVariables(profile: ThemeProfile): Record<string, string> {
    const vars = appearanceToCssVariables(toAppearance(profile));
    vars["--osyc-ai-first-line-indent"] = `${profile.typography.firstLineIndent}em`;
    vars["--osyc-ai-image-layout"] = profile.layout.imageLayout;
    vars["--osyc-ai-table-mode"] = profile.layout.tableMode;
    return vars;
}

export function themeProfileToScopedCss(profile: ThemeProfile, resourceUrl?: string, themeMode: "light" | "dark" = "light", fontResources: readonly { id: string; family: string }[] = []): string {
    const appearance = toAppearance(profile);
    const css = appearanceToCssText(appearance, resourceUrl, themeMode, fontResources);
    // Prefix each Markdown rule once. A global string replacement would also
    // prefix nested descendants such as `.markdown-reading-view
    // .markdown-preview-sizer` twice, producing selectors that never match.
    const scoped = css.replace(/(^|[}])([\t ]*)([^@{}][^{}]*)\{/g, (_match, boundary: string, whitespace: string, selector: string) => {
        const scopedSelector = selector
            .split(",")
            .map((item) => {
                const trimmed = item.trim();
                if (!trimmed || !trimmed.includes(".markdown-")) return trimmed;
                return `.osyc-theme-notes ${trimmed}`;
            })
            .join(", ");
        return `${boundary}${whitespace}${scopedSelector} {`;
    });
    const variables = appearanceToCssVariables(appearance, resourceUrl, themeMode, fontResources);
    const declarations = Object.entries(variables).map(([key, value]) => `${key}: ${value};`).join(" ");
    return `${scoped}

.osyc-theme-notes {
    ${declarations}
    /* Feed the original bundled themes through the same selected fonts. */
    --font-text: var(--osyc-ai-note-font-family);
    --font-editor: var(--osyc-ai-note-font-family);
    --font-monospace: var(--osyc-ai-code-font-family);
    --cw-font-family: var(--osyc-ai-note-font-family);
    --cw-heading-font-family: var(--osyc-ai-note-heading-font-family);
    --cw-reader-font-family: var(--osyc-ai-note-font-family);
    --osyc-ai-first-line-indent: ${profile.typography.firstLineIndent}em;
    --osyc-ai-image-layout: ${profile.layout.imageLayout};
    --osyc-ai-table-mode: ${profile.layout.tableMode};
}

/* Obsidian places the file title differently across reading/live-preview layouts. */
.osyc-theme-notes .inline-title {
    font-family: var(--osyc-ai-note-heading-font-family) !important;
    font-size: calc(var(--osyc-ai-note-font-size) * var(--osyc-ai-heading-scale)) !important;
    color: var(--osyc-ai-note-text) !important;
}

.osyc-theme-notes .markdown-reading-view p,
.osyc-theme-notes .markdown-preview-view p {
    text-indent: var(--osyc-ai-first-line-indent, 0em);
}
`;
}

/** Apply one replaceable style node so disabling the feature is reversible. */
export function applyThemeProfileStyles(
    profile: ThemeProfile,
    resourceUrl?: string,
    themeMode: "light" | "dark" = "light",
    fontResources: readonly { id: string; family: string }[] = []
): void {
    if (typeof document === "undefined") return;
    const vars = appearanceToCssVariables(toAppearance(profile), resourceUrl, themeMode, fontResources);
    vars["--osyc-ai-first-line-indent"] = `${profile.typography.firstLineIndent}em`;
    vars["--osyc-ai-image-layout"] = profile.layout.imageLayout;
    vars["--osyc-ai-table-mode"] = profile.layout.tableMode;
    const roots = document.querySelectorAll<HTMLElement>(
        "body, .osyc-ai-agent, .osyc-ai-appearance-preview, .osyc-theme-notes"
    );
    for (const root of Array.from(roots)) root.setCssProps(vars);
}
