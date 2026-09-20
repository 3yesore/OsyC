import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
    DEFAULT_SERVICE_URL,
    DIRECT_FALLBACK_SERVICE_URLS,
    LEGACY_OFFICIAL_SERVICE_URLS,
    OFFICIAL_SERVICE_URLS,
    resolveServiceCandidates,
    resolveServiceUrl,
} from "./serviceDefaults";

/** Cloudflare 橙云隧道的两个历史名字：2026-09-20 实测它们解析到 172.67.192.54 / 104.21.65.204。 */
const CLOUDFLARE_HISTORICAL_URLS = ["https://api.sacu3.cn", "https://osyctest.sacu3.cn"];

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

    it("候选顺序：默认与历史地址都用官方全序列，且 api4 排第一（当前只有它一条）", () => {
        expect(resolveServiceCandidates("")).toEqual([...OFFICIAL_SERVICE_URLS]);
        expect(resolveServiceCandidates("   ")).toEqual([...OFFICIAL_SERVICE_URLS]);
        expect(resolveServiceCandidates(null)).toEqual([...OFFICIAL_SERVICE_URLS]);
        expect(resolveServiceCandidates("https://api.sacu3.cn")).toEqual([...OFFICIAL_SERVICE_URLS]);
        expect(OFFICIAL_SERVICE_URLS[0]).toBe(DEFAULT_SERVICE_URL);
        // 2026-09-20 复核后唯一允许的直连入口；将来加直连备用时这里会变成两条。
        expect(OFFICIAL_SERVICE_URLS).toEqual(["https://api4.sacu3.cn"]);
    });

    it("候选链只含灰云直连：绝无 Cloudflare 的 api / osyctest（2026-09-20 定案）", () => {
        const candidates = [
            ...OFFICIAL_SERVICE_URLS,
            ...resolveServiceCandidates(""),
            ...resolveServiceCandidates(null),
            ...resolveServiceCandidates("https://api.sacu3.cn"),
            ...resolveServiceCandidates("https://osyctest.sacu3.cn"),
        ];
        expect(candidates).toContain(DEFAULT_SERVICE_URL);
        for (const cf of CLOUDFLARE_HISTORICAL_URLS) {
            expect(candidates).not.toContain(cf);
        }
        expect(candidates.every((url) => !url.includes("osyctest") && !url.includes("//api."))).toBe(true);
        // 直连备用扩展点保留，但当前为空 —— CF 地址永远不准进这个列表。
        expect(DIRECT_FALLBACK_SERVICE_URLS).toEqual([]);
    });

    it("Cloudflare 历史地址（api / osyctest）显式填写也会被迁移，运行时不再有 CF 路径", () => {
        for (const cf of CLOUDFLARE_HISTORICAL_URLS) {
            expect(LEGACY_OFFICIAL_SERVICE_URLS).toContain(cf);
            expect(resolveServiceUrl(cf)).toBe(DEFAULT_SERVICE_URL);
            expect(resolveServiceCandidates(cf)).toEqual([...OFFICIAL_SERVICE_URLS]);
        }
    });

    it("自填地址只有一个候选，绝不会被官方地址替换", () => {
        expect(resolveServiceCandidates("https://self-hosted.example.com")).toEqual(["https://self-hosted.example.com"]);
        expect(resolveServiceCandidates("http://127.0.0.1:8124/")).toEqual(["http://127.0.0.1:8124"]);
    });

    it("所有后端请求都收口到 apiRequest（故障转移点），且路径插值不能被写成普通字符串", () => {
        const src = readFileSync(fileURLToPath(new URL("./CmdAIAgent.ts", import.meta.url)), "utf8");
        expect(src).toContain("private async apiRequest(");
        // apiRequest 必须走顺序回退执行器，而不是自己抓一个端点就打。
        expect(src).toContain("tryEndpointsInOrder(");
        // 不允许再出现"直接拼 apiBase 的 requestUrl"
        expect(src).not.toMatch(/requestUrl\(\{\s*\n\s*url: `\$\{this\.settings\.apiBase\}/);
        // 含 \$\{...\} 的路径必须是模板字符串：写成普通双引号会导致字面量 \$\{taskId\} 发给后端
        expect(src).not.toMatch(/this\.apiRequest\("\/api\/[^"]*\$\{/);
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
        // 设置页不能再把 CF 地址当成可推荐的备用端点。
        expect(pane).not.toContain("FALLBACK_SERVICE_URLS");
    });
});
