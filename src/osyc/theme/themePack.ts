export type ThemePackScope = "notes" | "workspace";
export type ThemePackId = "minimal-original" | "chinese-writing-original";

export interface ThemePack {
    id: ThemePackId;
    name: string;
    license: "MIT";
    source: string;
    sourceCommit: string;
    licenseText: string;
    workspaceCss: string;
    notesCss: string;
}

export const THEME_PACK_OPTIONS: Record<ThemePackId | "none", string> = {
    none: "不使用原始主题包",
    "minimal-original": "Minimal（原始主题包）",
    "chinese-writing-original": "Chinese Writing Layout（原始主题包）",
};

declare const __OSYC_THEME_MINIMAL_CSS__: string | undefined;
declare const __OSYC_THEME_MINIMAL_NOTES_CSS__: string | undefined;
declare const __OSYC_THEME_CHINESE_WRITING_CSS__: string | undefined;
declare const __OSYC_THEME_CHINESE_WRITING_NOTES_CSS__: string | undefined;

const fallbackCss = ".markdown-preview-view, .markdown-rendered { color: inherit; }";
const fallbackNotesCss = ".osyc-theme-notes .markdown-preview-view, .osyc-theme-notes .markdown-rendered { color: inherit; }";
const MINIMAL_LICENSE = "MIT License\n\nCopyright (c) 2020-2024 Steph Ango (@kepano)\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the \\\"Software\\\"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.";
const CHINESE_WRITING_LICENSE = "MIT License\n\nCopyright (c) 2026 idoncar2\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the \\\"Software\\\"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.";

function injected(value: unknown, fallback: string): string {
    return typeof value === "string" && value.length > 0 ? value : fallback;
}

export const BUILTIN_THEME_PACKS: readonly ThemePack[] = [
    {
        id: "minimal-original",
        name: "Minimal",
        license: "MIT",
        source: "https://github.com/kepano/obsidian-minimal",
        sourceCommit: "c4704fbc23625f4b35b0ab9b2e1eb584e6891be2",
        licenseText: MINIMAL_LICENSE,
        workspaceCss: injected(typeof __OSYC_THEME_MINIMAL_CSS__ === "undefined" ? undefined : __OSYC_THEME_MINIMAL_CSS__, fallbackCss),
        notesCss: injected(typeof __OSYC_THEME_MINIMAL_NOTES_CSS__ === "undefined" ? undefined : __OSYC_THEME_MINIMAL_NOTES_CSS__, fallbackNotesCss),
    },
    {
        id: "chinese-writing-original",
        name: "Chinese Writing Layout",
        license: "MIT",
        source: "https://github.com/idoncar2/chinese-writing-layout",
        sourceCommit: "420c5b3598ec09a6f0ef4e3450506cdce861207d",
        licenseText: CHINESE_WRITING_LICENSE,
        workspaceCss: injected(typeof __OSYC_THEME_CHINESE_WRITING_CSS__ === "undefined" ? undefined : __OSYC_THEME_CHINESE_WRITING_CSS__, fallbackCss),
        notesCss: injected(typeof __OSYC_THEME_CHINESE_WRITING_NOTES_CSS__ === "undefined" ? undefined : __OSYC_THEME_CHINESE_WRITING_NOTES_CSS__, fallbackNotesCss),
    },
];

export function themePackForId(id: unknown): ThemePack | undefined {
    return BUILTIN_THEME_PACKS.find((pack) => pack.id === id);
}

/** Conservative fallback scoper used by tests and non-build tooling. Production assets are scoped at build time. */
export function scopeThemeCss(css: string): string {
    return css.replace(/(^|[}])([\t ]*)([^@{}][^{}]*)\{/g, (_match, boundary: string, whitespace: string, selector: string) => {
        const trimmed = selector.trim();
        if (!trimmed) return `${boundary}${whitespace}{`;
        const scopedSelector = trimmed
            .split(",")
            .map((item) => {
                const value = item.trim();
                if (/^(?:html|body|:root)(?=[:.#\s]|$)/.test(value)) return value.replace(/^(?:html|body|:root)/, ".osyc-theme-notes");
                return `.osyc-theme-notes ${value}`;
            })
            .join(", ");
        return `${boundary}${whitespace}${scopedSelector} {`;
    });
}

export function cssForThemePack(pack: ThemePack, scope: ThemePackScope): string {
    return scope === "workspace" ? pack.workspaceCss : pack.notesCss;
}

export function applyThemePackScope(pack: ThemePack, scope: ThemePackScope, doc: Document = document): () => void {
    const root = doc.body;
    const packClass = `osyc-theme-pack-${pack.id}`;
    root.classList.add(packClass);
    root.classList.toggle("osyc-theme-pack-notes", scope === "notes");
    return () => {
        root.classList.remove(packClass);
        root.classList.toggle("osyc-theme-pack-notes", false);
    };
}
