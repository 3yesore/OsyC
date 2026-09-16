import type { ThemePackId, ThemePackScope } from "@/osyc/theme/themePack";

export type AppearancePreset = "theme" | "mist" | "graphite" | "ocean" | "forest" | "amber" | "contrast" | "minimal" | "things" | "border" | "chinese-writing" | "codex" | "codesplash" | "image-layouts";
type BuiltInFontSource =
    | "obsidian"
    | "pingfang"
    | "yahei"
    | "noto-sans"
    | "source-han-sans"
    | "system-sans"
    | "song"
    | "kaiti"
    | "fangsong"
    | "noto-serif"
    | "source-han-serif"
    | "lxgw-wenkai"
    | "mi-sans"
    | "harmonyos-sans"
    | "alibaba-puhuiti"
    | "smiley-sans"
    | "sarasa-gothic"
    | "system-serif"
    | "inter"
    | "ibm-plex-sans"
    | "atkinson"
    | "literata"
    | "system-mono"
    | "noto-sans-mono"
    | "source-han-mono"
    | "sarasa-mono"
    | "maple-mono"
    | "iosevka"
    | "victor-mono"
    | "jetbrains-mono"
    | "cascadia-code"
    | "fira-code";
export type FontSource = BuiltInFontSource | `custom:${string}`;
export type Density = "minimal" | "compact" | "comfortable" | "spacious";
export type BackgroundMode = "theme" | "solid" | "image";

export const FONT_SOURCE_LABELS: Record<BuiltInFontSource, string> = {
    obsidian: "跟随 Obsidian",
    pingfang: "苹方 / 冬青黑体",
    yahei: "微软雅黑",
    "noto-sans": "Noto Sans CJK 思源黑体",
    "source-han-sans": "思源黑体",
    "system-sans": "系统无衬线",
    song: "宋体 / 宋体 SC",
    kaiti: "楷体",
    fangsong: "仿宋",
    "noto-serif": "Noto Serif CJK 思源宋体",
    "source-han-serif": "思源宋体",
    "lxgw-wenkai": "霞鹜文楷",
    "mi-sans": "MiSans",
    "harmonyos-sans": "鸿蒙 Sans",
    "alibaba-puhuiti": "阿里巴巴普惠体",
    "smiley-sans": "得意黑",
    "sarasa-gothic": "更纱黑体",
    "system-serif": "系统衬线",
    inter: "Inter",
    "ibm-plex-sans": "IBM Plex Sans",
    atkinson: "Atkinson Hyperlegible",
    literata: "Literata",
    "system-mono": "系统等宽",
    "noto-sans-mono": "Noto Sans Mono",
    "source-han-mono": "思源等宽",
    "sarasa-mono": "更纱等宽",
    "maple-mono": "Maple Mono",
    iosevka: "Iosevka",
    "victor-mono": "Victor Mono",
    "jetbrains-mono": "JetBrains Mono",
    "cascadia-code": "Cascadia Code",
    "fira-code": "Fira Code",
};

export const FONT_SOURCE_GROUPS = {
    chineseSans: ["pingfang", "yahei", "noto-sans", "source-han-sans"] as const,
    chineseSerif: ["song", "kaiti", "fangsong", "noto-serif", "source-han-serif", "lxgw-wenkai"] as const,
    chineseModern: ["mi-sans", "harmonyos-sans", "alibaba-puhuiti", "smiley-sans", "sarasa-gothic"] as const,
    system: ["obsidian", "system-sans", "system-serif"] as const,
    latinSans: ["inter", "ibm-plex-sans", "atkinson"] as const,
    latinSerif: ["literata"] as const,
    code: ["system-mono", "noto-sans-mono", "source-han-mono", "sarasa-mono", "maple-mono", "iosevka", "victor-mono", "jetbrains-mono", "cascadia-code", "fira-code"] as const,
};

export const THEME_PRESET_OPTIONS: Record<AppearancePreset, string> = {
    theme: "跟随 Obsidian",
    mist: "雾白",
    graphite: "石墨",
    ocean: "海蓝",
    forest: "森林",
    amber: "琥珀",
    contrast: "高对比度",
    minimal: "Minimal · 极简",
    things: "Things · 纸张",
    border: "Border · 边界",
    "chinese-writing": "Chinese Writing · 中文长文",
    codex: "Codex Markdown · 阅读",
    codesplash: "CodeSplash · 代码",
    "image-layouts": "Image Layouts · 媒体",
};

const THEME_PRESET_KEYS = Object.keys(THEME_PRESET_OPTIONS) as AppearancePreset[];

export function fontOptionsForSources(sources: readonly FontSource[]): Record<string, string> {
    return Object.fromEntries(
        [...new Set(sources)].map((source) => [source, source.startsWith("custom:") ? source.slice(7) : FONT_SOURCE_LABELS[source as BuiltInFontSource]])
    );
}

const FONT_SOURCE_KEYS = Object.keys(FONT_SOURCE_LABELS) as BuiltInFontSource[];

export interface AppearanceBackground {
    mode: BackgroundMode;
    solidColor: string | null;
    vaultPath: string | null;
    size: "cover" | "contain" | "auto";
    position: string;
    opacity: number;
    repeat: "no-repeat" | "repeat" | "repeat-x" | "repeat-y";
    blur: number;
    mobileMode: "follow" | "off" | "lower-opacity";
}

export interface AppearanceSettings {
    version: 1;
    /** Whether the structured appearance also styles Obsidian note content. */
    applyToNotes: boolean;
    /** Optional original open-source theme pack bundled by OsyC. */
    themePackId: ThemePackId | null;
    /** Original pack scope: notes is isolated; workspace preserves the original global CSS. */
    themePackScope: ThemePackScope;
    preset: AppearancePreset;
    fontSource: FontSource;
    headingFontSource: FontSource | "same";
    codeFontSource: FontSource;
    fontSize: number | null;
    headingScale: number;
    lineHeight: number | null;
    fontWeight: 400 | 500 | 600 | 700 | null;
    letterSpacing: number;
    density: Density;
    contentWidth: number | null;
    paragraphSpacing: number | null;
    longTextStrategy: "wrap" | "code-scroll" | "all-scroll";
    colourPreset: AppearancePreset;
    colourOverrides: Record<string, string | null>;
    background: AppearanceBackground;
    reducedMotion: "system" | "on" | "off";
    highContrast: boolean;
}

const DEFAULT_BACKGROUND: AppearanceBackground = {
    mode: "theme",
    solidColor: null,
    vaultPath: null,
    size: "cover",
    position: "center",
    opacity: 0,
    repeat: "no-repeat",
    blur: 0,
    mobileMode: "follow",
};

export const DEFAULT_APPEARANCE: AppearanceSettings = {
    version: 1,
    applyToNotes: true,
    themePackId: null,
    themePackScope: "notes",
    preset: "theme",
    fontSource: "obsidian",
    headingFontSource: "same",
    codeFontSource: "system-mono",
    fontSize: null,
    headingScale: 1.15,
    lineHeight: null,
    fontWeight: null,
    letterSpacing: 0,
    density: "comfortable",
    contentWidth: null,
    paragraphSpacing: null,
    longTextStrategy: "wrap",
    colourPreset: "theme",
    colourOverrides: {},
    background: { ...DEFAULT_BACKGROUND },
    reducedMotion: "system",
    highContrast: false,
};

/** Defaults contributed by the curated open-source-inspired presets. */
const CURATED_PRESET_DEFAULTS: Partial<Record<AppearancePreset, Partial<Pick<AppearanceSettings, "fontSource" | "headingFontSource" | "codeFontSource" | "lineHeight" | "letterSpacing" | "contentWidth">>>> = {
    minimal: { fontSource: "system-sans", headingFontSource: "same", codeFontSource: "system-mono", lineHeight: 1.5 },
    things: { fontSource: "system-serif", headingFontSource: "same", codeFontSource: "jetbrains-mono", lineHeight: 1.55 },
    border: { fontSource: "system-sans", headingFontSource: "same", codeFontSource: "jetbrains-mono", lineHeight: 1.5 },
    "chinese-writing": { fontSource: "lxgw-wenkai", headingFontSource: "same", codeFontSource: "system-mono", lineHeight: 1.8, letterSpacing: 0.02 },
    codex: { fontSource: "inter", headingFontSource: "same", codeFontSource: "jetbrains-mono", lineHeight: 1.6, contentWidth: 780 },
    codesplash: { fontSource: "inter", headingFontSource: "same", codeFontSource: "jetbrains-mono", lineHeight: 1.55 },
    "image-layouts": { fontSource: "system-sans", headingFontSource: "same", codeFontSource: "jetbrains-mono", lineHeight: 1.55, contentWidth: 900 },
};

const PRESET_COLOURS: Record<Exclude<AppearancePreset, "theme">, Record<string, string>> = {
    mist: { text: "#263238", textMuted: "#607078", surface: "#f7f9fa", surfaceAlt: "#eef2f4", border: "#cbd5da", accent: "#3d6f8f", link: "#2c628e" },
    graphite: { text: "#e8eaed", textMuted: "#aeb4ba", surface: "#202326", surfaceAlt: "#2b2f33", border: "#484f56", accent: "#8ab4f8", link: "#9cc4ff" },
    ocean: { text: "#12344d", textMuted: "#52748c", surface: "#f0f7fb", surfaceAlt: "#e0f0f8", border: "#b7d2e0", accent: "#1677a8", link: "#086a9a" },
    forest: { text: "#20352b", textMuted: "#5c7566", surface: "#f2f8f3", surfaceAlt: "#e3f0e6", border: "#bdd2c3", accent: "#3b7d57", link: "#2b6d48" },
    amber: { text: "#3e2e18", textMuted: "#806b4c", surface: "#fff9ed", surfaceAlt: "#f9efd8", border: "#e2cda1", accent: "#b77712", link: "#98620b" },
    contrast: { text: "#000000", textMuted: "#222222", surface: "#ffffff", surfaceAlt: "#ffffff", border: "#000000", accent: "#0000ee", link: "#0000ee" },
    minimal: { text: "#30343b", textMuted: "#727982", surface: "#fbfcfd", surfaceAlt: "#f1f3f5", border: "#dfe3e7", accent: "#5b6775", link: "#536f8a" },
    things: { text: "#302b25", textMuted: "#766d63", surface: "#fbf8f1", surfaceAlt: "#f2ecdf", border: "#ded4c3", accent: "#a05d32", link: "#8a512e" },
    border: { text: "#26323a", textMuted: "#687781", surface: "#f7fafb", surfaceAlt: "#eaf0f2", border: "#aebdc4", accent: "#34748a", link: "#28657a" },
    "chinese-writing": { text: "#332c27", textMuted: "#75685f", surface: "#fbf7ef", surfaceAlt: "#f2e9dc", border: "#d9c9b5", accent: "#9a5b3a", link: "#865039" },
    codex: { text: "#26364a", textMuted: "#6b7b8f", surface: "#f6f8fb", surfaceAlt: "#e9eef5", border: "#c7d2df", accent: "#356aa0", link: "#2f6294" },
    codesplash: { text: "#20242b", textMuted: "#69717d", surface: "#f8fafc", surfaceAlt: "#e9eef4", border: "#c7d0db", accent: "#c4513e", link: "#ae4435" },
    "image-layouts": { text: "#283038", textMuted: "#6a757d", surface: "#f8faf9", surfaceAlt: "#e9efec", border: "#c7d4cd", accent: "#3c8065", link: "#327057" },
};

const DARK_PRESET_COLOURS: Record<Exclude<AppearancePreset, "theme">, Record<string, string>> = {
    mist: { text: "#edf2f5", textMuted: "#b6c2c9", surface: "#252a2e", surfaceAlt: "#30373c", border: "#56626a", accent: "#9ed8ff", link: "#a9ddff" },
    graphite: { text: "#eef1f3", textMuted: "#b6bec5", surface: "#202326", surfaceAlt: "#2b2f33", border: "#484f56", accent: "#8ab4f8", link: "#9cc4ff" },
    ocean: { text: "#e6f4ff", textMuted: "#b8d1df", surface: "#152733", surfaceAlt: "#1d3848", border: "#3e6175", accent: "#79c8f5", link: "#91d7ff" },
    forest: { text: "#e7f4eb", textMuted: "#b9d0bf", surface: "#1c2b22", surfaceAlt: "#263b2d", border: "#466650", accent: "#83d39d", link: "#94e2ac" },
    amber: { text: "#fff3d6", textMuted: "#d7c29a", surface: "#302715", surfaceAlt: "#40341e", border: "#725d32", accent: "#f2bd57", link: "#ffd47c" },
    contrast: { text: "#ffffff", textMuted: "#eeeeee", surface: "#000000", surfaceAlt: "#111111", border: "#ffffff", accent: "#66ccff", link: "#66ccff" },
    minimal: { text: "#eef1f4", textMuted: "#b4bdc5", surface: "#202429", surfaceAlt: "#2b3036", border: "#4b545d", accent: "#b4c6d8", link: "#b5d4ec" },
    things: { text: "#f5eee1", textMuted: "#c6b8a4", surface: "#2b2723", surfaceAlt: "#3a332b", border: "#65594a", accent: "#e09a63", link: "#efb17b" },
    border: { text: "#e7f0f3", textMuted: "#b0c1c8", surface: "#1c2a30", surfaceAlt: "#263941", border: "#526d78", accent: "#70c1d7", link: "#8bd5e7" },
    "chinese-writing": { text: "#f3eadc", textMuted: "#c4b5a3", surface: "#2b2622", surfaceAlt: "#3b332b", border: "#6b5a48", accent: "#e0a37e", link: "#edb28e" },
    codex: { text: "#e9f0f7", textMuted: "#b2c1d0", surface: "#1f2b3a", surfaceAlt: "#2b3a4d", border: "#526b84", accent: "#76b5ef", link: "#8fc7ff" },
    codesplash: { text: "#edf1f5", textMuted: "#b1bac5", surface: "#20252c", surfaceAlt: "#2c333d", border: "#56616d", accent: "#ff8a73", link: "#ff9d8a" },
    "image-layouts": { text: "#e9f2ed", textMuted: "#b2c3b8", surface: "#1d2923", surfaceAlt: "#293930", border: "#4f6b5a", accent: "#82d0a4", link: "#9be3ba" },
};

function cloneDefault(): AppearanceSettings {
    return { ...DEFAULT_APPEARANCE, colourOverrides: {}, background: { ...DEFAULT_BACKGROUND } };
}

/**
 * The note toggle is a single-source-of-truth switch. When it is off, the
 * Agent must not retain a second, custom skin while the note view follows the
 * host theme. Treat the whole appearance as inherited in that state.
 */
function effectiveAppearance(settings: AppearanceSettings): AppearanceSettings {
    if (settings.applyToNotes) return settings;
    return {
        ...settings,
        preset: "theme",
        fontSource: "obsidian",
        headingFontSource: "same",
        codeFontSource: "system-mono",
        fontSize: null,
        headingScale: DEFAULT_APPEARANCE.headingScale,
        lineHeight: null,
        fontWeight: null,
        letterSpacing: 0,
        density: DEFAULT_APPEARANCE.density,
        contentWidth: null,
        paragraphSpacing: null,
        longTextStrategy: "wrap",
        colourPreset: "theme",
        colourOverrides: {},
        background: { ...DEFAULT_BACKGROUND },
        reducedMotion: "system",
        highContrast: false,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value as T : fallback;
}

function safeColour(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const colour = value.trim();
    return /^(#[0-9a-f]{3,8}|rgba?\([^)]{1,80}\)|hsla?\([^)]{1,80}\))$/i.test(colour) ? colour : null;
}

export function isVaultImagePath(value: unknown): value is string {
    if (typeof value !== "string" || !value || value.startsWith("/") || value.includes("\\")) return false;
    if (value.split("/").some((part) => !part || part === "." || part === "..")) return false;
    return /\.(?:png|jpe?g|gif|webp|avif)$/i.test(value);
}

export function parseAppearance(value: unknown): AppearanceSettings {
    const result = cloneDefault();
    if (!isRecord(value)) return result;
    result.applyToNotes = typeof value.applyToNotes === "boolean" ? value.applyToNotes : result.applyToNotes;
    result.themePackId = value.themePackId === null
        ? null
        : value.themePackId === "minimal-original" || value.themePackId === "chinese-writing-original"
            ? value.themePackId
            : result.themePackId;
    result.themePackScope = value.themePackScope === "workspace" ? "workspace" : result.themePackScope;
    result.preset = enumValue(value.preset, THEME_PRESET_KEYS, result.preset);
    const validFontSource = (source: unknown, fallback: FontSource): FontSource => {
        if (typeof source === "string" && (FONT_SOURCE_KEYS as readonly string[]).includes(source)) return source as BuiltInFontSource;
        if (typeof source === "string" && /^custom:[a-z0-9][a-z0-9_-]{0,63}$/i.test(source)) return source as `custom:${string}`;
        return fallback;
    };
    result.fontSource = validFontSource(value.fontSource, result.fontSource);
    result.headingFontSource = value.headingFontSource === "same"
        ? "same"
        : validFontSource(value.headingFontSource, "same" as FontSource);
    result.codeFontSource = validFontSource(value.codeFontSource, result.codeFontSource);
    result.fontSize = value.fontSize === null ? null : Math.round(clamp(value.fontSize, 13, 24, 16));
    result.headingScale = clamp(value.headingScale, 1, 1.5, result.headingScale);
    result.lineHeight = value.lineHeight === null ? null : clamp(value.lineHeight, 1.3, 2.2, 1.5);
    result.fontWeight = value.fontWeight === null
        ? null
        : ([400, 500, 600, 700] as const).includes(value.fontWeight as 400 | 500 | 600 | 700)
          ? value.fontWeight as 400 | 500 | 600 | 700
          : null;
    result.letterSpacing = clamp(value.letterSpacing, -0.02, 0.08, 0);
    result.density = enumValue(value.density, ["minimal", "compact", "comfortable", "spacious"], result.density);
    result.contentWidth = value.contentWidth === null ? null : Math.round(clamp(value.contentWidth, 280, 960, 640));
    result.paragraphSpacing = value.paragraphSpacing === null ? null : clamp(value.paragraphSpacing, 0, 2.5, 1);
    result.longTextStrategy = enumValue(value.longTextStrategy, ["wrap", "code-scroll", "all-scroll"], result.longTextStrategy);
    result.colourPreset = enumValue(value.colourPreset, THEME_PRESET_KEYS, result.colourPreset);
    if (isRecord(value.colourOverrides)) {
        result.colourOverrides = Object.entries(value.colourOverrides).reduce<Record<string, string>>((colours, [key, colour]) => {
            if (!/^[a-z][a-zA-Z]*$/.test(key)) return colours;
            const safe = safeColour(colour);
            if (safe !== null) colours[key] = safe;
            return colours;
        }, {});
    }
    if (isRecord(value.background)) {
        const bg = value.background;
        result.background.mode = enumValue(bg.mode, ["theme", "solid", "image"], result.background.mode);
        result.background.solidColor = safeColour(bg.solidColor);
        result.background.vaultPath = isVaultImagePath(bg.vaultPath) ? bg.vaultPath : null;
        result.background.size = enumValue(bg.size, ["cover", "contain", "auto"], result.background.size);
        result.background.position = typeof bg.position === "string" && /^(?:left|center|right|\d{1,3}%) (?:top|center|bottom|\d{1,3}%)$/.test(bg.position) ? bg.position : "center";
        result.background.opacity = clamp(bg.opacity, 0, 1, result.background.opacity);
        result.background.repeat = enumValue(bg.repeat, ["no-repeat", "repeat", "repeat-x", "repeat-y"], result.background.repeat);
        result.background.blur = clamp(bg.blur, 0, 16, result.background.blur);
        result.background.mobileMode = enumValue(bg.mobileMode, ["follow", "off", "lower-opacity"], result.background.mobileMode);
    }
    result.reducedMotion = enumValue(value.reducedMotion, ["system", "on", "off"], result.reducedMotion);
    result.highContrast = typeof value.highContrast === "boolean" ? value.highContrast : result.highContrast;
    return result;
}

const FONT_FAMILY_VALUES: Record<BuiltInFontSource, string> = {
    obsidian: "var(--font-text)",
    pingfang: '"PingFang SC", "PingFang TC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
    yahei: '"Microsoft YaHei", "微软雅黑", "PingFang SC", sans-serif',
    // These families are bundled by utils/embed-osyc-fonts.mjs. Keep the
    // first family name byte-for-byte aligned with the generated @font-face.
    "noto-sans": '"Noto Sans SC", "Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif',
    "source-han-sans": '"Noto Sans SC", "Source Han Sans SC", "Noto Sans CJK SC", sans-serif',
    "system-sans": "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    song: '"SimSun", "宋体", "Songti SC", "STSong", "Noto Sans SC", serif',
    kaiti: '"KaiTi", "楷体", "Kaiti SC", "STKaiti", "Noto Sans SC", serif',
    fangsong: '"FangSong", "仿宋", "STFangsong", "Noto Sans SC", serif',
    "noto-serif": '"Noto Serif CJK SC", "Noto Serif SC", "Source Han Serif SC", "Songti SC", "Noto Sans SC", serif',
    "source-han-serif": '"Source Han Serif SC", "Noto Serif CJK SC", "Noto Serif SC", "Noto Sans SC", serif',
    "lxgw-wenkai": '"LXGW WenKai", "霞鹜文楷", "Kaiti SC", "KaiTi", "Noto Sans SC", serif',
    "mi-sans": '"MiSans", "MiSans Latin", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif',
    "harmonyos-sans": '"HarmonyOS Sans SC", "HarmonyOS Sans", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif',
    "alibaba-puhuiti": '"Alibaba PuHuiTi 2.0", "Alibaba PuHuiTi", "Microsoft YaHei", "Noto Sans SC", sans-serif',
    "smiley-sans": '"Smiley Sans", "得意黑", "Microsoft YaHei", "Noto Sans SC", sans-serif',
    "sarasa-gothic": '"Sarasa Gothic SC", "更纱黑体 SC", "Source Han Sans SC", "Noto Sans SC", sans-serif',
    "system-serif": "ui-serif, Georgia, serif",
    inter: '"Inter", system-ui, -apple-system, sans-serif',
    "ibm-plex-sans": '"IBM Plex Sans", "Inter", "Noto Sans", system-ui, sans-serif',
    atkinson: '"Atkinson Hyperlegible", "Inter", system-ui, sans-serif',
    literata: '"Literata", "Noto Serif", "Inter", Georgia, serif',
    "system-mono": "ui-monospace, SFMono-Regular, Menlo, monospace",
    "noto-sans-mono": '"Noto Sans Mono", "Noto Sans CJK SC", "JetBrains Mono", ui-monospace, monospace',
    "source-han-mono": '"Source Han Mono", "Noto Sans Mono CJK SC", "JetBrains Mono", ui-monospace, monospace',
    "sarasa-mono": '"Sarasa Mono SC", "更纱等宽 SC", "Source Han Mono", "JetBrains Mono", ui-monospace, monospace',
    "maple-mono": '"Maple Mono", "Maple Mono NF", "Sarasa Mono SC", "JetBrains Mono", ui-monospace, monospace',
    iosevka: '"Iosevka", "Iosevka Term", "JetBrains Mono", ui-monospace, monospace',
    "victor-mono": '"Victor Mono", "Fira Code", "JetBrains Mono", ui-monospace, monospace',
    "jetbrains-mono": '"JetBrains Mono", "Cascadia Code", "Fira Code", ui-monospace, monospace',
    "cascadia-code": '"Cascadia Code", "Cascadia Mono", "JetBrains Mono", Consolas, ui-monospace, monospace',
    "fira-code": '"Fira Code", "Fira Mono", "JetBrains Mono", ui-monospace, monospace',
};

export function fontFamilyForSource(source: FontSource, customFamily?: string): string {
    if (source.startsWith("custom:")) {
        const family = customFamily?.replace(/["\\]/g, "").trim();
        return family ? `"${family}", sans-serif` : "sans-serif";
    }
    return FONT_FAMILY_VALUES[source as BuiltInFontSource];
}

function localResourceUrl(value: unknown): string | null {
    if (typeof value !== "string" || !/^(?:app|file):\/\//i.test(value)) return null;
    return value.replace(/["'()\\]/g, "");
}

export function appearanceToCssVariables(settings: AppearanceSettings, resourceUrl?: string, themeMode: "light" | "dark" = "light", fontResources: readonly { id: string; family: string }[] = []): Record<string, string> {
    const effective = effectiveAppearance(settings);
    // Older saved settings used colourPreset as the implicit typography
    // selector. Keep that migration fallback while making the explicit
    // appearance preset authoritative for new selections.
    const curated = CURATED_PRESET_DEFAULTS[effective.preset] ?? CURATED_PRESET_DEFAULTS[effective.colourPreset] ?? {};
    const resolvedFontSource = effective.fontSource === "obsidian" && curated.fontSource ? curated.fontSource : effective.fontSource;
    const resolvedHeadingFontSource = effective.headingFontSource === "same" ? resolvedFontSource : effective.headingFontSource;
    const resolvedCodeFontSource = effective.codeFontSource === "system-mono" && curated.codeFontSource ? curated.codeFontSource : effective.codeFontSource;
    const resolvedLineHeight = effective.lineHeight ?? curated.lineHeight ?? null;
    const resolvedLetterSpacing = effective.letterSpacing === 0 && curated.letterSpacing !== undefined ? curated.letterSpacing : effective.letterSpacing;
    const resolvedContentWidth = effective.contentWidth ?? curated.contentWidth ?? null;
    const customFamily = (source: FontSource): string | undefined => {
        if (!source.startsWith("custom:")) return undefined;
        return fontResources.find((resource) => resource.id === source.slice(7))?.family;
    };
    // A selected image must be visible on first use. The old default was zero,
    // which made a valid resource look broken until the user found the slider.
    const backgroundOpacity = effective.background.mode === "image"
        && effective.background.vaultPath
        && effective.background.opacity === 0
        ? 0.24
        : effective.background.opacity;
    const preset = effective.colourPreset === "theme" ? {} : (themeMode === "dark" ? DARK_PRESET_COLOURS[effective.colourPreset] : PRESET_COLOURS[effective.colourPreset]);
    const colours = { ...preset, ...effective.colourOverrides };
    const vars: Record<string, string> = {
        "--osyc-ai-font-family": fontFamilyForSource(resolvedFontSource, customFamily(resolvedFontSource)),
        "--osyc-ai-heading-font-family": fontFamilyForSource(resolvedHeadingFontSource, customFamily(resolvedHeadingFontSource)),
        "--osyc-ai-code-font-family": fontFamilyForSource(resolvedCodeFontSource, customFamily(resolvedCodeFontSource)),
        "--osyc-ai-heading-scale": String(effective.headingScale),
        "--osyc-ai-letter-spacing": `${resolvedLetterSpacing}em`,
        "--osyc-ai-density": effective.density,
        "--osyc-ai-density-gap": ({ minimal: "6px", compact: "9px", comfortable: "12px", spacious: "18px" } as Record<Density, string>)[effective.density],
        "--osyc-ai-long-text-strategy": effective.longTextStrategy,
        "--osyc-ai-background-image": "none",
        "--osyc-ai-background-size": effective.background.size,
        "--osyc-ai-background-position": effective.background.position,
        "--osyc-ai-background-repeat": effective.background.repeat,
        "--osyc-ai-background-opacity": String(backgroundOpacity),
        "--osyc-ai-background-blur": `${effective.background.blur}px`,
    };
    if (effective.fontSize !== null) vars["--osyc-ai-font-size"] = `${effective.fontSize}px`;
    if (resolvedLineHeight !== null) vars["--osyc-ai-line-height"] = String(resolvedLineHeight);
    if (effective.fontWeight !== null) vars["--osyc-ai-font-weight"] = String(effective.fontWeight);
    if (resolvedContentWidth !== null) vars["--osyc-ai-content-width"] = `${resolvedContentWidth}px`;
    if (effective.paragraphSpacing !== null) vars["--osyc-ai-paragraph-spacing"] = `${effective.paragraphSpacing}em`;
    const aliases: Record<string, string> = { text: "text", textMuted: "text-muted", surface: "surface", surfaceAlt: "surface-alt", border: "border", accent: "accent", link: "link", focus: "focus", success: "success", warning: "warning", error: "error", queued: "queued" };
    for (const [key, value] of Object.entries(colours)) {
        const safe = safeColour(value);
        if (safe && aliases[key]) vars[`--osyc-ai-${aliases[key]}`] = safe;
    }
    if (typeof colours.surface === "string") vars["--osyc-ai-background-color"] = colours.surface;
    if (effective.background.mode === "solid" && effective.background.solidColor) {
        vars["--osyc-ai-background-color"] = effective.background.solidColor;
    }
    if (effective.background.mode === "image") {
        const local = localResourceUrl(resourceUrl);
        if (effective.background.vaultPath && local) vars["--osyc-ai-background-image"] = `url("${local}")`;
    }
    // Note-specific aliases keep the note CSS independent from Agent internals.
    // They intentionally remain OsyC-prefixed and are only consumed by the
    // selectors emitted by appearanceToCssText().
    vars["--osyc-ai-note-font-family"] = vars["--osyc-ai-font-family"];
    vars["--osyc-ai-note-heading-font-family"] = vars["--osyc-ai-heading-font-family"];
    vars["--osyc-ai-note-font-size"] = vars["--osyc-ai-font-size"] ?? "var(--font-text-size, 16px)";
    vars["--osyc-ai-note-line-height"] = vars["--osyc-ai-line-height"] ?? "var(--line-height-normal, 1.5)";
    vars["--osyc-ai-note-font-weight"] = vars["--osyc-ai-font-weight"] ?? "400";
    vars["--osyc-ai-note-letter-spacing"] = vars["--osyc-ai-letter-spacing"];
    vars["--osyc-ai-note-background"] = vars["--osyc-ai-background-color"] ?? "var(--background-primary)";
    vars["--osyc-ai-note-background-image"] = vars["--osyc-ai-background-image"];
    vars["--osyc-ai-note-background-size"] = vars["--osyc-ai-background-size"];
    vars["--osyc-ai-note-background-position"] = vars["--osyc-ai-background-position"];
    vars["--osyc-ai-note-background-repeat"] = vars["--osyc-ai-background-repeat"];
    vars["--osyc-ai-note-text"] = vars["--osyc-ai-text"] ?? "var(--text-normal)";
    vars["--osyc-ai-note-muted"] = vars["--osyc-ai-text-muted"] ?? "var(--text-muted)";
    vars["--osyc-ai-note-link"] = vars["--osyc-ai-link"] ?? "var(--link-color, var(--interactive-accent))";
    vars["--osyc-ai-note-border"] = vars["--osyc-ai-border"] ?? "var(--background-modifier-border)";
    vars["--osyc-ai-note-code-background"] = vars["--osyc-ai-surface-alt"] ?? "var(--background-secondary)";
    vars["--osyc-ai-note-block-background"] = vars["--osyc-ai-surface-alt"] ?? "var(--background-secondary)";
    vars["--osyc-ai-note-code-text"] = vars["--osyc-ai-note-text"] ?? "var(--text-normal)";
    vars["--osyc-ai-note-hr"] = vars["--osyc-ai-note-border"];
    vars["--osyc-ai-note-content-width"] = vars["--osyc-ai-content-width"] ?? "none";
    vars["--osyc-ai-note-paragraph-spacing"] = vars["--osyc-ai-paragraph-spacing"] ?? "1em";
    return vars;
}

/**
 * Render the scoped stylesheet used by the live Obsidian note views.
 *
 * The selectors deliberately target Markdown reading/preview and CodeMirror
 * content only. Workspace chrome, settings and unrelated plugins do not read
 * these variables, so the user's Obsidian shell remains untouched.
 */
export function appearanceToCssText(
    settings: AppearanceSettings,
    resourceUrl?: string,
    themeMode: "light" | "dark" = "light",
    fontResources: readonly { id: string; family: string }[] = []
): string {
    const effective = effectiveAppearance(settings);
    const vars = appearanceToCssVariables(effective, resourceUrl, themeMode, fontResources);
    const declarations = Object.entries(vars).map(([key, value]) => `${key}: ${value};`).join(" ");
    const agentCss = `.osyc-ai-agent { ${declarations}
    font-family: var(--osyc-ai-font-family);
    font-size: var(--osyc-ai-font-size);
    line-height: var(--osyc-ai-line-height);
    color: var(--osyc-ai-text);
    background-color: var(--osyc-ai-background-color, var(--osyc-ai-surface));
    background-image: none;
    background-size: var(--osyc-ai-background-size);
    background-position: var(--osyc-ai-background-position);
    background-repeat: var(--osyc-ai-background-repeat);
    position: relative;
    isolation: isolate;
}`;
    const agentThemeAdapterCss = `.osyc-ai-agent .ai-shell {
    background: var(--osyc-ai-surface-alt) !important;
    color: var(--osyc-ai-text) !important;
}
.osyc-ai-agent .ai-chat,
.osyc-ai-agent .ai-chat-header,
.osyc-ai-agent .ai-composer {
    background: var(--osyc-ai-surface) !important;
    background-color: var(--osyc-ai-surface) !important;
    color: var(--osyc-ai-text) !important;
    border-color: var(--osyc-ai-border) !important;
}
.osyc-ai-agent .ai-sidebar,
.osyc-ai-agent .ai-new-chat,
.osyc-ai-agent .ai-composer-box,
.osyc-ai-agent .ai-quick-chip,
.osyc-ai-agent .ai-field,
.osyc-ai-agent .ai-suggestion,
.osyc-ai-agent .ai-inline-panel,
.osyc-ai-agent .ai-confirm-panel,
.osyc-ai-agent .ai-cloud-row {
    background: var(--osyc-ai-surface-alt) !important;
    color: var(--osyc-ai-text) !important;
    border-color: var(--osyc-ai-border) !important;
}
.osyc-ai-agent .ai-session-item,
.osyc-ai-agent .ai-sidebar-action,
.osyc-ai-agent .ai-session-group,
.osyc-ai-agent .ai-hint {
    color: var(--osyc-ai-text-muted) !important;
}
.osyc-ai-agent .ai-session-item.active,
.osyc-ai-agent .ai-sidebar-action.active {
    color: var(--osyc-ai-accent) !important;
    background: var(--osyc-ai-surface-alt) !important;
}
.osyc-ai-agent .ai-send-btn,
.osyc-ai-agent .ai-btn-primary,
.osyc-ai-agent .ai-welcome-mark,
.osyc-ai-agent .ai-oc-avatar,
.osyc-ai-agent .ai-plan-badge[data-plan="member"],
.osyc-ai-agent .ai-plan-badge[data-plan="pro"] {
    background: var(--osyc-ai-accent) !important;
    border-color: var(--osyc-ai-accent) !important;
}
/* The ChatGPT reading model: the user turn is a neutral bubble that differs
 * from the chat surface by one step, not an accent-filled block, so long
 * conversations do not turn into a wall of saturated colour. */
.osyc-ai-agent .ai-message-user .ai-message-body {
    background: var(--osyc-ai-surface-alt) !important;
    border-color: var(--osyc-ai-border) !important;
    color: var(--osyc-ai-text) !important;
}
.osyc-ai-agent .ai-assistant-content,
.osyc-ai-agent .ai-message-assistant,
.osyc-ai-agent .ai-welcome,
.osyc-ai-agent .ai-activation {
    color: var(--osyc-ai-text) !important;
}
.osyc-ai-agent .ai-task-card,
.osyc-ai-agent .ai-task-response,
.osyc-ai-agent .ai-confirmation,
.osyc-ai-agent .ai-confirm-panel,
.osyc-ai-agent .ai-suggestion,
.osyc-ai-agent .ai-inline-panel {
    background: var(--osyc-ai-surface-alt) !important;
    background-color: var(--osyc-ai-surface-alt) !important;
    border-color: var(--osyc-ai-border) !important;
    color: var(--osyc-ai-text) !important;
}
.osyc-ai-agent .ai-task-head,
.osyc-ai-agent .ai-task-message,
.osyc-ai-agent .ai-task-response-content,
.osyc-ai-agent .ai-task-trace,
.osyc-ai-agent .ai-task-foot,
.osyc-ai-agent .ai-task-costs,
.osyc-ai-agent .ai-confirmation-note,
.osyc-ai-agent .ai-confirmation-message {
    color: var(--osyc-ai-text-muted) !important;
}
.osyc-ai-agent .ai-task-card.ai-status-running {
    border-left-color: var(--osyc-ai-accent) !important;
}
.osyc-ai-agent .ai-task-card.ai-status-done {
    border-left-color: var(--osyc-ai-success) !important;
}
.osyc-ai-agent .ai-task-card.ai-status-failed,
.osyc-ai-agent .ai-task-error,
.osyc-ai-agent .ai-assistant-error {
    border-color: var(--osyc-ai-error) !important;
    color: var(--osyc-ai-error) !important;
}
.osyc-ai-agent .ai-task-delivery-success,
.osyc-ai-agent .ai-assistant-delivery-success {
    color: var(--osyc-ai-success) !important;
}
.osyc-ai-agent .ai-task-delivery-error,
.osyc-ai-agent .ai-assistant-delivery-error {
    color: var(--osyc-ai-warning) !important;
}
.osyc-ai-agent .ai-banner {
    background: var(--osyc-ai-surface-alt) !important;
    color: var(--osyc-ai-warning) !important;
    border-block: 1px solid var(--osyc-ai-border) !important;
}
.osyc-ai-agent .ai-banner-dot,
.osyc-ai-agent .ai-task-trace-dot,
.osyc-ai-agent .ai-assistant-activity-dot {
    background: var(--osyc-ai-accent) !important;
}
.osyc-ai-agent .ai-text-btn,
.osyc-ai-agent .ai-task-file,
.osyc-ai-agent .ai-task-trace summary,
.osyc-ai-agent .ai-confirmation-path,
.osyc-ai-agent .ai-assistant-file {
    color: var(--osyc-ai-link) !important;
}
.osyc-ai-agent .ai-assistant-content pre,
.osyc-ai-agent .ai-task-response-content pre,
.osyc-ai-agent .ai-rich-content blockquote {
    background: var(--osyc-ai-surface) !important;
    border-color: var(--osyc-ai-border) !important;
    color: var(--osyc-ai-text) !important;
}
.osyc-ai-agent .ai-rich-content code {
    font-family: var(--osyc-ai-code-font-family) !important;
}
.osyc-ai-agent::before {
    content: "";
    position: absolute;
    z-index: -1;
    inset: 0;
    pointer-events: none;
    background-image: var(--osyc-ai-background-image);
    background-size: var(--osyc-ai-background-size);
    background-position: var(--osyc-ai-background-position);
    background-repeat: var(--osyc-ai-background-repeat);
    opacity: var(--osyc-ai-background-opacity);
    filter: blur(var(--osyc-ai-background-blur));
    transform: scale(1.02);
}`;
    if (!settings.applyToNotes) return `${agentCss}\n\n${agentThemeAdapterCss}`;

    const noteBackgroundLayerCss = `.markdown-preview-view,
.markdown-reading-view,
.markdown-source-view .cm-scroller {
    position: relative;
    isolation: isolate;
}
.markdown-preview-view::before,
.markdown-reading-view::before,
.markdown-source-view .cm-scroller::before {
    content: "";
    position: absolute;
    z-index: -1;
    inset: 0;
    pointer-events: none;
    background-image: var(--osyc-ai-note-background-image);
    background-size: var(--osyc-ai-note-background-size);
    background-position: var(--osyc-ai-note-background-position);
    background-repeat: var(--osyc-ai-note-background-repeat);
    opacity: var(--osyc-ai-background-opacity);
    filter: blur(var(--osyc-ai-background-blur));
    transform: scale(1.02);
}`;

    const longTextCss = effective.longTextStrategy === "all-scroll"
        ? `.markdown-reading-view,
.markdown-preview-view,
.markdown-source-view {
    overflow-x: auto;
    overflow-wrap: normal;
}
`
        : effective.longTextStrategy === "code-scroll"
          ? `.markdown-reading-view,
.markdown-preview-view,
.markdown-source-view {
    overflow-wrap: anywhere;
    word-break: break-word;
}

.markdown-reading-view pre,
.markdown-preview-view pre,
.markdown-source-view .cm-content {
    overflow-x: auto;
}
`
          : `.markdown-reading-view,
.markdown-preview-view,
.markdown-source-view {
    overflow-wrap: anywhere;
    word-break: break-word;
}
`;

    return `${agentCss}

${agentThemeAdapterCss}

${noteBackgroundLayerCss}

.markdown-reading-view,
.markdown-preview-view,
.markdown-rendered,
.markdown-source-view,
.markdown-source-view.mod-cm6,
.markdown-source-view .cm-editor,
.markdown-source-view .cm-content,
.markdown-source-view .cm-line {
    ${declarations}
    --code-background: var(--osyc-ai-note-code-background);
    --code-normal: var(--osyc-ai-note-code-text);
    --blockquote-background: var(--osyc-ai-note-block-background);
    --table-border-color: var(--osyc-ai-note-border);
}

.markdown-reading-view,
.markdown-preview-view,
.markdown-rendered,
.markdown-source-view,
.markdown-source-view.mod-cm6,
.markdown-source-view .cm-scroller {
    color: var(--osyc-ai-note-text);
    background-color: var(--osyc-ai-note-background);
    background-image: none;
    background-size: var(--osyc-ai-note-background-size);
    background-position: var(--osyc-ai-note-background-position);
    background-repeat: var(--osyc-ai-note-background-repeat);
}

${longTextCss}

.markdown-reading-view .markdown-preview-sizer,
.markdown-preview-view .markdown-preview-sizer,
.markdown-rendered {
    max-width: var(--osyc-ai-note-content-width);
    margin-inline: auto;
    font-family: var(--osyc-ai-note-font-family) !important;
    font-size: var(--osyc-ai-note-font-size) !important;
    line-height: var(--osyc-ai-note-line-height) !important;
    font-weight: var(--osyc-ai-note-font-weight) !important;
    letter-spacing: var(--osyc-ai-note-letter-spacing) !important;
    color: var(--osyc-ai-note-text) !important;
}

.markdown-source-view .cm-content,
.markdown-source-view .cm-line,
.markdown-source-view.mod-cm6 .cm-content,
.markdown-source-view.mod-cm6 .cm-line,
.markdown-source-view .HyperMD-codeblock {
    font-family: var(--osyc-ai-note-font-family) !important;
    font-size: var(--osyc-ai-note-font-size) !important;
    line-height: var(--osyc-ai-note-line-height) !important;
    font-weight: var(--osyc-ai-note-font-weight) !important;
    letter-spacing: var(--osyc-ai-note-letter-spacing) !important;
    color: var(--osyc-ai-note-text) !important;
}

.markdown-source-view .cm-scroller {
    background-image: var(--osyc-ai-note-background-image);
    background-size: var(--osyc-ai-note-background-size);
    background-position: var(--osyc-ai-note-background-position);
    background-repeat: var(--osyc-ai-note-background-repeat);
}

.markdown-reading-view h1,
.markdown-reading-view h2,
.markdown-reading-view h3,
.markdown-reading-view h4,
.markdown-reading-view h5,
.markdown-reading-view h6,
.markdown-preview-view h1,
.markdown-preview-view h2,
.markdown-preview-view h3,
.markdown-preview-view h4,
.markdown-preview-view h5,
.markdown-preview-view h6,
.markdown-rendered h1,
.markdown-rendered h2,
.markdown-rendered h3,
.markdown-rendered h4,
.markdown-rendered h5,
.markdown-rendered h6,
.markdown-source-view .HyperMD-header,
.markdown-reading-view .inline-title,
.markdown-preview-view .inline-title,
.markdown-rendered .inline-title,
.markdown-source-view .inline-title {
    font-family: var(--osyc-ai-note-heading-font-family) !important;
    font-size: calc(var(--osyc-ai-note-font-size) * var(--osyc-ai-heading-scale)) !important;
    color: var(--osyc-ai-note-text) !important;
}

.markdown-reading-view p,
.markdown-preview-view p,
.markdown-rendered p {
    margin-block-end: var(--osyc-ai-note-paragraph-spacing);
}

.markdown-reading-view a,
.markdown-preview-view a,
.markdown-rendered a {
    color: var(--osyc-ai-note-link);
}

.markdown-reading-view blockquote,
.markdown-preview-view blockquote,
.markdown-rendered blockquote {
    border-inline-start-color: var(--osyc-ai-note-link);
    background-color: var(--osyc-ai-note-block-background);
    color: var(--osyc-ai-note-muted);
    padding-block: .65em;
    padding-inline-end: 1em;
}

.markdown-reading-view pre,
.markdown-preview-view pre,
.markdown-rendered pre,
.markdown-reading-view .cm-content pre,
.markdown-preview-view .cm-content pre,
.markdown-source-view.mod-cm6 .cm-content .HyperMD-codeblock {
    background-color: var(--osyc-ai-note-code-background) !important;
    border: 1px solid var(--osyc-ai-note-border) !important;
    border-radius: 8px;
    color: var(--osyc-ai-note-code-text) !important;
    padding: 1em;
    overflow-x: auto;
}

.markdown-reading-view pre code,
.markdown-preview-view pre code,
.markdown-rendered pre code,
.markdown-reading-view .cm-content pre code,
.markdown-preview-view .cm-content pre code,
.markdown-source-view.mod-cm6 .cm-content .HyperMD-codeblock {
    background: transparent !important;
    border: 0 !important;
    color: inherit !important;
    font-family: var(--osyc-ai-code-font-family) !important;
    font-size: .92em !important;
    padding: 0;
}

.markdown-reading-view :not(pre) > code,
.markdown-preview-view :not(pre) > code,
.markdown-rendered :not(pre) > code {
    background-color: var(--osyc-ai-note-code-background) !important;
    border: 1px solid var(--osyc-ai-note-border) !important;
    border-radius: 4px;
    color: var(--osyc-ai-note-code-text) !important;
    font-family: var(--osyc-ai-code-font-family) !important;
    padding: .12em .35em;
}

.markdown-reading-view table,
.markdown-preview-view table,
.markdown-rendered table {
    border-collapse: collapse;
    background-color: var(--osyc-ai-note-block-background);
}

.markdown-reading-view th,
.markdown-reading-view td,
.markdown-preview-view th,
.markdown-preview-view td,
.markdown-rendered th,
.markdown-rendered td {
    border-color: var(--osyc-ai-note-border) !important;
    color: var(--osyc-ai-note-text) !important;
}

.markdown-reading-view th,
.markdown-preview-view th,
.markdown-rendered th {
    background-color: var(--osyc-ai-note-code-background) !important;
}

.markdown-reading-view .callout,
.markdown-preview-view .callout,
.markdown-rendered .callout {
    background-color: var(--osyc-ai-note-block-background) !important;
    border-color: var(--osyc-ai-note-border) !important;
    color: var(--osyc-ai-note-text) !important;
}

.markdown-reading-view hr,
.markdown-preview-view hr,
.markdown-rendered hr {
    border-color: var(--osyc-ai-note-hr) !important;
    opacity: .75;
}

.markdown-reading-view .internal-embed,
.markdown-preview-view .internal-embed,
.markdown-reading-view .media-embed,
.markdown-preview-view .media-embed,
.markdown-rendered .internal-embed,
.markdown-rendered .media-embed {
    border-color: var(--osyc-ai-note-border);
    background-color: var(--osyc-ai-note-block-background);
}

.markdown-reading-view img,
.markdown-preview-view img,
.markdown-rendered img {
    max-width: 100%;
    height: auto;
}

@media (max-width: 720px) {
    .markdown-reading-view .markdown-preview-sizer,
    .markdown-preview-view .markdown-preview-sizer,
    .markdown-rendered {
        max-width: 100%;
    }
}
`;
}

/** Apply the validated appearance as a single OsyC-local style node. */
export function applyAppearanceStyles(settings: AppearanceSettings, resourceUrl?: string, themeMode: "light" | "dark" = "light"): void {
    if (typeof document === "undefined") return;
    const vars = appearanceToCssVariables(settings, resourceUrl, themeMode);
    const roots = document.querySelectorAll<HTMLElement>(
        "body, .osyc-ai-agent, .osyc-ai-appearance-preview, .osyc-theme-notes"
    );
    for (const root of Array.from(roots)) root.setCssProps(vars);
}
