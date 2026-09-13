import { describe, expect, it } from "vitest";
import {
    BUILTIN_THEME_PACKS,
    createThemePackStyle,
    scopeThemeCss,
    themePackForId,
    type ThemePackScope,
} from "./themePack";

describe("OsyC theme pack loader", () => {
    it("registers the first-party bundled MIT theme packs with pinned sources", () => {
        expect(BUILTIN_THEME_PACKS.map((pack) => pack.id)).toEqual(["minimal-original", "chinese-writing-original"]);
        expect(BUILTIN_THEME_PACKS.every((pack) => pack.license === "MIT")).toBe(true);
        expect(BUILTIN_THEME_PACKS.every((pack) => /^[0-9a-f]{40}$/.test(pack.sourceCommit))).toBe(true);
        expect(BUILTIN_THEME_PACKS.every((pack) => pack.licenseText.startsWith("MIT License"))).toBe(true);
    });

    it("keeps workspace CSS raw but scopes note CSS to the OsyC note root", () => {
        const css = "body { color: red; } :root { --accent: blue; } .markdown-preview-view p { margin: 0; } @keyframes pulse { from { opacity: 0; } }";
        const scoped = scopeThemeCss(css);
        expect(scoped).toContain(".osyc-theme-notes {");
        expect(scoped).toContain(".osyc-theme-notes .markdown-preview-view p");
        expect(scoped).not.toMatch(/(?:^|\n)\s*body\s*\{/);
        expect(scoped).not.toMatch(/(?:^|\n)\s*:root\s*\{/);
        expect(scoped).toContain("@keyframes pulse");
    });

    it("creates one replaceable style node and removes it without touching OsyC styles", () => {
        const pack = themePackForId("minimal-original");
        expect(pack).toBeDefined();
        const styles: Array<{ id?: string; dataset: Record<string, string>; textContent: string; remove(): void }> = [];
        const doc = {
            getElementById: (id: string) => styles.find((style) => style.id === id) ?? null,
            createElement: () => {
                const style = {
                    id: undefined as string | undefined,
                    dataset: {} as Record<string, string>,
                    textContent: "",
                    remove: () => {
                        const index = styles.indexOf(style);
                        if (index >= 0) styles.splice(index, 1);
                    },
                };
                styles.push(style);
                return style;
            },
            head: { appendChild: (style: (typeof styles)[number]) => style },
            documentElement: { appendChild: (style: (typeof styles)[number]) => style },
            querySelector: (selector: string) => selector === "style[data-osyc-theme-pack]" ? styles.find((style) => style.dataset.osycThemePack) ?? null : null,
        } as unknown as Document;
        const osycStyle = { id: "osyc-ai-appearance-style", dataset: {}, textContent: "keep me", remove: () => undefined };
        styles.push(osycStyle);
        const mount = createThemePackStyle(pack!, "notes" satisfies ThemePackScope, doc);
        expect(doc.querySelector("style[data-osyc-theme-pack]")).not.toBeNull();
        expect(doc.querySelector("style[data-osyc-theme-pack]")?.textContent).toContain("osyc-theme-notes");
        mount.remove();
        expect(doc.querySelector("style[data-osyc-theme-pack]")).toBeNull();
        expect(doc.getElementById("osyc-ai-appearance-style")?.textContent).toBe("keep me");
    });
});
