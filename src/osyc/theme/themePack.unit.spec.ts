import { describe, expect, it } from "vitest";
import {
    BUILTIN_THEME_PACKS,
    applyThemePackScope,
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

    it("applies a replaceable scope class without creating a style node", () => {
        const pack = themePackForId("minimal-original");
        expect(pack).toBeDefined();
        const classes = new Set<string>();
        const doc = {
            body: { classList: {
                add: (name: string) => classes.add(name),
                remove: (name: string) => classes.delete(name),
                toggle: (name: string, enabled: boolean) => enabled ? classes.add(name) : classes.delete(name),
            } },
        } as unknown as Document;
        const remove = applyThemePackScope(pack!, "notes" satisfies ThemePackScope, doc);
        expect(classes.has("osyc-theme-pack-minimal-original")).toBe(true);
        expect(classes.has("osyc-theme-pack-notes")).toBe(true);
        remove();
        expect(classes.has("osyc-theme-pack-minimal-original")).toBe(false);
        expect(classes.has("osyc-theme-pack-notes")).toBe(false);
    });
});
