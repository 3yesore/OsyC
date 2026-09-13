import { describe, expect, it, vi } from "vitest";
import { annotateFontLabel, checkFontAvailability } from "./fontAvailability";

describe("OsyC font availability", () => {
    it("uses the browser FontFaceSet when available", () => {
        const fonts = { check: vi.fn(() => true) };
        expect(checkFontAvailability('16px "Microsoft YaHei", sans-serif', fonts)).toBe("available");
        expect(fonts.check).toHaveBeenCalledWith('16px "Microsoft YaHei"');
    });

    it("reports fallback or unknown without changing the selected font", () => {
        expect(checkFontAvailability('16px "Missing Font", sans-serif', { check: () => false })).toBe("fallback");
        expect(checkFontAvailability('16px "Missing Font", sans-serif')).toBe("unknown");
    });

    it("keeps labels readable and explicit", () => {
        expect(annotateFontLabel("微软雅黑", "available")).toBe("微软雅黑 · 本机可用");
        expect(annotateFontLabel("霞鹜文楷", "fallback")).toBe("霞鹜文楷 · 将回退");
        expect(annotateFontLabel("系统无衬线", "unknown")).toBe("系统无衬线 · 无法检测");
    });
});
