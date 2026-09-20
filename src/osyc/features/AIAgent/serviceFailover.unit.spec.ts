import { describe, expect, it } from "vitest";

import { shouldTryNextEndpoint, tryEndpointsInOrder } from "./serviceFailover";

/**
 * 端点故障转移的判定规则：决定"这次失败要不要换下一条端点重试"。
 * 判错的代价是两个方向都很难查：该换不换 = 用户看到失败；不该换却换 = 可能重复生效（例如重复激活）。
 */
describe("端点故障转移判定", () => {
    it("网络层失败一定换下一条（请求没有完成）", () => {
        expect(shouldTryNextEndpoint(null, new Error("fetch failed"), "POST")).toBe(true);
        expect(shouldTryNextEndpoint(0, new Error("fetch failed"), "GET")).toBe(true);
    });

    it("502 = 网关够不到后端，请求没进应用，任何方法都换端点", () => {
        expect(shouldTryNextEndpoint(502, null, "POST")).toBe(true);
        expect(shouldTryNextEndpoint(502, null, "GET")).toBe(true);
    });

    it("503/504 只有幂等 GET 才换端点（POST 可能已生效，不能在另一端点重做）", () => {
        expect(shouldTryNextEndpoint(503, null, "GET")).toBe(true);
        expect(shouldTryNextEndpoint(504, null, "get")).toBe(true);
        expect(shouldTryNextEndpoint(503, null, "POST")).toBe(false);
        expect(shouldTryNextEndpoint(504, null, "POST")).toBe(false);
    });

    it("业务状态码不换端点（400/401/403/404/409/429/500/501 原样交给调用方）", () => {
        for (const status of [400, 401, 403, 404, 409, 429, 500, 501]) {
            expect(shouldTryNextEndpoint(status, null, "GET")).toBe(false);
            expect(shouldTryNextEndpoint(status, null, "POST")).toBe(false);
        }
    });
});

/**
 * 顺序回退执行器：当前生产候选链只有 api4 一条（CF 已被排除），
 * 这组测试用**合成候选列表**把"顺序回退 + 成功后短路"的机制钉住 ——
 * 机制就位，将来加第二条直连入口时直接生效。
 */
describe("端点顺序回退", () => {
    it("api4 失败按顺序回退到第二个候选", async () => {
        const tried: string[] = [];
        const result = await tryEndpointsInOrder(
            ["https://api4.sacu3.cn", "https://direct2.example.com"],
            "GET",
            async (base) => {
                tried.push(base);
                if (base.includes("api4.")) throw new Error("socket closed");
                return { base, value: "ok", status: 200 };
            }
        );
        expect(tried).toEqual(["https://api4.sacu3.cn", "https://direct2.example.com"]);
        expect(result.base).toBe("https://direct2.example.com");
        expect(result.value).toBe("ok");
    });

    it("回退成功后不再无谓重试：后面的候选一次都不会碰", async () => {
        const tried: string[] = [];
        const result = await tryEndpointsInOrder(
            ["https://api4.sacu3.cn", "https://direct2.example.com", "https://direct3.example.com"],
            "GET",
            async (base) => {
                tried.push(base);
                if (base.includes("api4.")) throw new Error("socket closed");
                return { base, value: "ok", status: 200 };
            }
        );
        expect(tried).toEqual(["https://api4.sacu3.cn", "https://direct2.example.com"]);
        expect(result.base).toBe("https://direct2.example.com");
    });

    it("502 会换端点；POST 的 503 不换（原响应交回调用方）", async () => {
        const statuses: number[] = [];
        const gateway = await tryEndpointsInOrder(
            ["https://a.example", "https://b.example"],
            "GET",
            async (base) => {
                statuses.push(base.endsWith("a.example") ? 502 : 200);
                return { base, value: "body", status: base.endsWith("a.example") ? 502 : 200 };
            }
        );
        expect(statuses).toEqual([502, 200]);
        expect(gateway.base).toBe("https://b.example");

        const calls: string[] = [];
        const post = await tryEndpointsInOrder(
            ["https://a.example", "https://b.example"],
            "POST",
            async (base) => {
                calls.push(base);
                return { base, value: "body", status: 503 };
            }
        );
        expect(calls).toEqual(["https://a.example"]);
        expect(post.status).toBe(503);
        expect(post.base).toBe("https://a.example");
    });

    it("每个端点只试一次，候选全部失败时抛最后一次错误（不无限放大）", async () => {
        const tried: string[] = [];
        await expect(
            tryEndpointsInOrder(
                ["https://a.example", "https://b.example"],
                "GET",
                async (base) => {
                    tried.push(base);
                    throw new Error(`boom-${base}`);
                }
            )
        ).rejects.toThrow("boom-https://b.example");
        expect(tried).toEqual(["https://a.example", "https://b.example"]);
    });

    it("每次换端点都会回调 onSkip，便于打日志", async () => {
        const skips: string[] = [];
        await tryEndpointsInOrder(
            ["https://a.example", "https://b.example"],
            "GET",
            async (base) => {
                if (base.endsWith("a.example")) throw new Error("down");
                return { base, value: "ok", status: 200 };
            },
            (skip) => skips.push(skip.base)
        );
        expect(skips).toEqual(["https://a.example"]);
    });
});
