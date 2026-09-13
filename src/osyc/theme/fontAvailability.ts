export type FontAvailability = "available" | "fallback" | "unknown";

export interface FontFaceSetLike {
    check(font: string): boolean;
}

function primaryFamily(fontFamily: string): string {
    const first = fontFamily.replace(/^\s*\d+(?:\.\d+)?px\s+/i, "").split(",", 1)[0]?.trim() ?? "";
    return first.replace(/^['"]|['"]$/g, "");
}

/** Check the selected primary family without loading or probing remote assets. */
export function checkFontAvailability(fontFamily: string, fonts?: FontFaceSetLike): FontAvailability {
    if (!fonts || typeof fonts.check !== "function") return "unknown";
    const family = primaryFamily(fontFamily);
    if (!family) return "unknown";
    try {
        return fonts.check(`16px "${family}"`) ? "available" : "fallback";
    } catch {
        return "unknown";
    }
}

export function annotateFontLabel(label: string, availability: FontAvailability): string {
    const suffix = availability === "available"
        ? "本机可用"
        : availability === "fallback"
          ? "将回退"
          : "无法检测";
    return `${label} · ${suffix}`;
}
