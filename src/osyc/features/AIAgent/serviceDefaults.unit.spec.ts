import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { DEFAULT_SERVICE_URL, LEGACY_OFFICIAL_SERVICE_URLS, resolveServiceUrl } from "./serviceDefaults";

/**
 * 发布到社区目录的包里没有人预置服务地址，而历史默认值是空串 ——
 * 结果是「装完插件 + 粘卡密」直接激活失败。这组测试把"必须有可用默认值"钉住。
 */
describe("官方服务地址默认值", () => {
    it("默认地址是可用的 https 入口，且不带尾斜杠", () => {
        expect(DEFAULT_SERVICE_URL.startsWith("https://")).toBe(true);
        expect(DEFAULT_SERVICE_URL.endsWith("/")).toBe(false);
        expect(() => new URL(DEFAULT_SERVICE_URL)).not.toThrow();
    });

    it("空值 / 未配置 → 官方默认（新用户不填地址也能激活）", () => {
        expect(resolveServiceUrl("")).toBe(DEFAULT_SERVICE_URL);
        expect(resolveServiceUrl("   ")).toBe(DEFAULT_SERVICE_URL);
        expect(resolveServiceUrl(null)).toBe(DEFAULT_SERVICE_URL);
        expect(resolveServiceUrl(undefined)).toBe(DEFAULT_SERVICE_URL);
    });

    it("历史官方地址（含尾斜杠写法）迁移到官方默认", () => {
        for (const legacy of LEGACY_OFFICIAL_SERVICE_URLS) {
            expect(resolveServiceUrl(legacy)).toBe(DEFAULT_SERVICE_URL);
            expect(resolveServiceUrl(`${legacy}/`)).toBe(DEFAULT_SERVICE_URL);
            expect(resolveServiceUrl(` ${legacy}/ `)).toBe(DEFAULT_SERVICE_URL);
        }
    });

    it("用户自填地址原样尊重，只去掉尾斜杠", () => {
        expect(resolveServiceUrl("https://self-hosted.example.com")).toBe("https://self-hosted.example.com");
        expect(resolveServiceUrl("https://self-hosted.example.com/")).toBe("https://self-hosted.example.com");
        expect(resolveServiceUrl("http://127.0.0.1:8124/")).toBe("http://127.0.0.1:8124");
    });

    it("加载路径与设置页真的接了这个默认值（删掉就会红）", () => {
        const ui = readFileSync(fileURLToPath(new URL("../../serviceFeatures/useAIAgentUI.ts", import.meta.url)), "utf8");
        expect(ui).toContain("resolveServiceUrl(saved.apiBase)");
        const pane = readFileSync(fileURLToPath(new URL("./osycSettingsPane.ts", import.meta.url)), "utf8");
        expect(pane).toContain("DEFAULT_SERVICE_URL");
        expect(pane).toContain(".setPlaceholder(DEFAULT_SERVICE_URL)");
        expect(pane).toContain("controller.snapshot().serviceUrl || DEFAULT_SERVICE_URL");
        expect(pane).not.toContain("https://api.example.com");
    });
});
