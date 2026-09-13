import { CURRENT_PLUGIN_ID } from "@/osyc/migration/pluginIdentity";

export const FONT_RESOURCE_DIR = `.obsidian/plugins/${CURRENT_PLUGIN_ID}/fonts`;

export interface FontResource {
    id: string;
    family: string;
    fileName: string;
    weight: number;
    style: "normal" | "italic";
}

export interface FontFaceDescriptor {
    family: string;
    source: string;
    descriptors: {
        weight: string;
        style: "normal" | "italic";
        display: "swap";
    };
}

export function fontSourceForResource(id: string): string {
    return `custom:${id}`;
}

export function resourceIdFromFontSource(source: unknown): string | null {
    if (typeof source !== "string" || !source.startsWith("custom:")) return null;
    const id = source.slice("custom:".length);
    return isSafeId(id) ? id : null;
}

export function fontResourceForSource(source: unknown, resources: readonly FontResource[]): FontResource | undefined {
    const id = resourceIdFromFontSource(source);
    return id ? resources.find((resource) => resource.id === id) : undefined;
}

export function buildFontFaceStyles(resources: readonly FontResource[], resourceUrls: Readonly<Record<string, string>>): string {
    return resources
        .map((resource) => buildFontFaceCss(resource, resourceUrls[resource.id] ?? ""))
        .filter(Boolean)
        .join("\n");
}

const FONT_EXTENSIONS = /\.(?:woff2?|ttf|otf)$/i;

export function isFontFileName(value: unknown): value is string {
    return typeof value === "string"
        && value.length > 0
        && value.length <= 160
        && !value.includes("/")
        && !value.includes("\\")
        && value !== "."
        && value !== ".."
        && FONT_EXTENSIONS.test(value);
}

function isSafeId(value: unknown): value is string {
    return typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value);
}

export function fontResourcePath(id: string, fileName: string): string | null {
    if (!isSafeId(id) || !isFontFileName(fileName)) return null;
    return `${FONT_RESOURCE_DIR}/${id}.${fileName.split(".").pop()?.toLowerCase()}`;
}

function parseWeight(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value)) return 400;
    return Math.min(900, Math.max(100, Math.round(value / 100) * 100));
}

export function parseFontResources(value: unknown): FontResource[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const result: FontResource[] = [];
    for (const entry of value) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        const item = entry as Record<string, unknown>;
        const id = item.id;
        const family = typeof item.family === "string" ? item.family.trim().slice(0, 80) : "";
        const fileName = item.fileName;
        if (!isSafeId(id) || !family || !isFontFileName(fileName) || seen.has(id)) continue;
        seen.add(id);
        result.push({
            id,
            family,
            fileName,
            weight: parseWeight(item.weight),
            style: item.style === "italic" ? "italic" : "normal",
        });
    }
    return result;
}

function localResourceUrl(value: unknown): string | null {
    if (typeof value !== "string" || !/^(?:app|file):\/\//i.test(value)) return null;
    return value.replace(/["'()\\]/g, "");
}

export function buildFontFaceCss(resource: FontResource, resourceUrl: string): string {
    const descriptor = createFontFaceDescriptor(resource, resourceUrl);
    if (!descriptor) return "";
    const format = fontFormatForFileName(resource.fileName);
    return `@font-face { font-family: "${descriptor.family}"; src: ${descriptor.source} format("${format}"); font-weight: ${descriptor.descriptors.weight}; font-style: ${descriptor.descriptors.style}; font-display: ${descriptor.descriptors.display}; }`;
}

function fontFormatForFileName(fileName: string): "woff" | "woff2" | "truetype" | "opentype" {
    const extension = fileName.toLowerCase().split(".").pop();
    if (extension === "woff") return "woff";
    if (extension === "woff2") return "woff2";
    if (extension === "otf") return "opentype";
    return "truetype";
}

/** Build the same local-only descriptor for the browser FontFace API. */
export function createFontFaceDescriptor(resource: FontResource, resourceUrl: string): FontFaceDescriptor | null {
    const url = localResourceUrl(resourceUrl);
    if (!url || !isSafeId(resource.id) || !isFontFileName(resource.fileName) || !resource.family.trim()) return null;
    const family = resource.family.replace(/["\\]/g, "").trim();
    if (!family) return null;
    return {
        family,
        source: `url("${url}")`,
        descriptors: {
            weight: String(parseWeight(resource.weight)),
            style: resource.style === "italic" ? "italic" : "normal",
            display: "swap",
        },
    };
}

export function canRemoveFontResource(id: string, referencedIds: readonly string[]): boolean {
    return !referencedIds.includes(id);
}
