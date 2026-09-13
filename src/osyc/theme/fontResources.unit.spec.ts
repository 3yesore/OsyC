import { describe, expect, it } from "vitest";
import {
    FONT_RESOURCE_DIR,
    buildFontFaceCss,
    createFontFaceDescriptor,
    fontResourcePath,
    isFontFileName,
    parseFontResources,
    canRemoveFontResource,
    fontSourceForResource,
    resourceIdFromFontSource,
    type FontResource,
} from "./fontResources";

describe("OsyC local font resources", () => {
    it("accepts only safe local font filenames", () => {
        expect(isFontFileName("霞鹜文楷.woff2")).toBe(true);
        expect(isFontFileName("font.ttf")).toBe(true);
        expect(isFontFileName("../secret.ttf")).toBe(false);
        expect(isFontFileName("font.css")).toBe(false);
    });

    it("keeps resources inside the plugin directory", () => {
        expect(fontResourcePath("lxgw-wenkai", "霞鹜文楷.woff2")).toBe(`${FONT_RESOURCE_DIR}/lxgw-wenkai.woff2`);
        expect(fontResourcePath("../escape", "font.ttf")).toBeNull();
    });

    it("drops malformed metadata and deduplicates ids", () => {
        const resources = parseFontResources([
            { id: "demo", family: "Demo", fileName: "demo.woff2", weight: 400, style: "normal" },
            { id: "demo", family: "Other", fileName: "other.woff2" },
            { id: "bad", family: "", fileName: "bad.css" },
        ]);
        expect(resources).toHaveLength(1);
        expect(resources[0].family).toBe("Demo");
    });

    it("emits local-only @font-face CSS and protects referenced resources", () => {
        const resource: FontResource = { id: "demo", family: "Demo", fileName: "demo.woff2", weight: 500, style: "normal" };
        const css = buildFontFaceCss(resource, `app://local/${FONT_RESOURCE_DIR}/demo.woff2`);
        expect(css).toContain("@font-face");
        expect(css).toContain('font-family: "Demo"');
        expect(css).not.toContain("http");
        expect(css).toContain('format("woff2")');
        expect(buildFontFaceCss({ ...resource, fileName: "demo.woff" }, "app://local/demo.woff")).toContain('format("woff")');
        expect(buildFontFaceCss({ ...resource, fileName: "demo.ttf" }, "app://local/demo.ttf")).toContain('format("truetype")');
        expect(buildFontFaceCss({ ...resource, fileName: "demo.otf" }, "app://local/demo.otf")).toContain('format("opentype")');
        expect(canRemoveFontResource("demo", ["demo", "other"])).toBe(false);
        expect(canRemoveFontResource("demo", ["other"])).toBe(true);
    });

    it("creates a browser-loadable descriptor for a local font resource", () => {
        const resource: FontResource = { id: "demo", family: "Demo", fileName: "demo.woff2", weight: 600, style: "italic" };
        expect(createFontFaceDescriptor(resource, `app://local/${FONT_RESOURCE_DIR}/demo.woff2`)).toEqual({
            family: "Demo",
            source: `url("app://local/${FONT_RESOURCE_DIR}/demo.woff2")`,
            descriptors: { weight: "600", style: "italic", display: "swap" },
        });
        expect(createFontFaceDescriptor(resource, "https://example.com/demo.woff2")).toBeNull();
    });

    it("maps an imported resource to a validated custom font source", () => {
        expect(fontSourceForResource("lxgw-wenkai")).toBe("custom:lxgw-wenkai");
        expect(resourceIdFromFontSource("custom:lxgw-wenkai")).toBe("lxgw-wenkai");
        expect(resourceIdFromFontSource("custom:../escape")).toBeNull();
        expect(resourceIdFromFontSource("system-sans")).toBeNull();
    });
});
