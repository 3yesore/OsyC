import { beforeEach, describe, expect, it, vi } from "vitest";

const requestUrlMock = vi.fn();
vi.mock("@/deps.ts", () => ({
    requestUrl: (...args: unknown[]) => requestUrlMock(...args),
}));

import { get } from "svelte/store";
import { CmdAIAgent, type AIEntitlements, type PlanType } from "./CmdAIAgent";

interface RequestShape {
    url?: unknown;
    method?: unknown;
    body?: unknown;
}

const reply = (status: number, data: unknown) => ({ status, json: data });

/**
 * 后端 /api/status 现在与 /api/activate 同源下发 entitlements（snake_case）。
 * 这里按线上真实结构造数据，避免测试自己的字段名与后端漂移。
 */
function entitlementsFor(plan: PlanType): Record<string, unknown> {
    const base = {
        sync: true,
        ai_tasks: true,
        schedules: false,
        cloud_vault: false,
        cloud_quota_mb: 0,
        max_devices: 2,
        skills: ["obsidian-markdown"],
        model_quota: 0,
    };
    if (plan === "member") {
        return { ...base, schedules: true, max_devices: 5, skills: ["layout-polish", "graph-ai"], model_quota: 11.33 };
    }
    if (plan === "pro") {
        return { ...base, schedules: true, cloud_vault: true, cloud_quota_mb: 333.33, max_devices: 10, model_quota: 17.33 };
    }
    return base;
}

/** UI 档位标签的唯一来源（与 AIAgentAccountModal.ts:PLAN_LABEL 同口径）。 */
const PLAN_LABEL: Record<PlanType, string> = { base: "基础版", member: "会员", pro: "Pro" };

describe("CmdAIAgent · 档位标签 D6（纯邮箱登录的 member/pro）", () => {
    let agent: CmdAIAgent;

    beforeEach(() => {
        requestUrlMock.mockReset();
        agent = new CmdAIAgent();
        agent.deviceId = "test-device";
        agent.configure("https://api.example.com", "");
    });

    /**
     * 一次真实的「邮箱验证码登录」：POST /api/email/verify 只回 token，
     * 档位/权益必须由客户端随后 GET /api/status 取回。
     */
    function mockEmailLogin(plan: PlanType, statusBody: Record<string, unknown> = {}) {
        requestUrlMock.mockImplementation(async (request: RequestShape) => {
            const url = String(request.url ?? "");
            if (url.endsWith("/api/email/verify")) {
                return reply(200, {
                    account: { email_masked: "u***@example.com" },
                    registered: false,
                    session_token: "email-session",
                    token: "email-device-token",
                    card_key: `CARD-${plan.toUpperCase()}`,
                });
            }
            if (url.endsWith("/api/status")) {
                return reply(200, {
                    credits: 800,
                    credits_yuan: 12,
                    model_quota: 11.33,
                    expire_at: 1893456000,
                    model: "DeepSeek-V4-Flash",
                    plan,
                    entitlements: entitlementsFor(plan),
                    ...statusBody,
                });
            }
            return reply(404, {});
        });
    }

    it("邮箱登录 member：loginWithEmail 后 state.plan=member，标签显示「会员」", async () => {
        mockEmailLogin("member");

        const result = await agent.loginWithEmail("user@example.com", "123456");

        expect(result.ok).toBe(true);
        const state = get(agent.state);
        expect(state.plan).toBe("member");
        expect(PLAN_LABEL[state.plan]).toBe("会员");
        expect(state.entitlements?.maxDevices).toBe(5);
        expect(state.entitlements?.schedules).toBe(true);
        expect(state.entitlements?.cloudVault).toBe(false);
    });

    it("邮箱登录 pro：loginWithEmail 后 state.plan=pro，标签显示「Pro」", async () => {
        mockEmailLogin("pro");

        const result = await agent.loginWithEmail("user@example.com", "123456");

        expect(result.ok).toBe(true);
        const state = get(agent.state);
        expect(state.plan).toBe("pro");
        expect(PLAN_LABEL[state.plan]).toBe("Pro");
        expect(state.entitlements?.cloudVault).toBe(true);
        expect(state.entitlements?.maxDevices).toBe(10);
        expect(state.entitlements?.cloudQuotaMb).toBeCloseTo(333.33, 2);
    });

    it("邮箱登录 base：标签仍是「基础版」，且没有多给会员权益", async () => {
        mockEmailLogin("base");

        const result = await agent.loginWithEmail("user@example.com", "123456");

        expect(result.ok).toBe(true);
        const state = get(agent.state);
        expect(state.plan).toBe("base");
        expect(PLAN_LABEL[state.plan]).toBe("基础版");
        expect(state.entitlements?.schedules).toBe(false);
        expect(state.entitlements?.cloudVault).toBe(false);
        expect(state.entitlements?.maxDevices).toBe(2);
    });

    it("refreshStatus 解析 snake_case entitlements（不再只读 credits）", async () => {
        agent.configure("https://api.example.com", "token");
        requestUrlMock.mockResolvedValue(
            reply(200, { credits: 100, plan: "member", entitlements: entitlementsFor("member") })
        );

        await agent.refreshStatus();

        const ent: AIEntitlements | null = get(agent.state).entitlements;
        expect(get(agent.state).plan).toBe("member");
        expect(ent?.aiTasks).toBe(true);
        expect(ent?.schedules).toBe(true);
        expect(ent?.maxDevices).toBe(5);
        expect(ent?.skills).toEqual(["layout-polish", "graph-ai"]);
    });

    it("老后端不返回 plan/entitlements 时保留既有档位，绝不回落基础版", async () => {
        agent.configure("https://api.example.com", "token");
        agent.state.update((s) => ({
            ...s,
            activated: true,
            plan: "pro",
            entitlements: {
                sync: true,
                aiTasks: true,
                schedules: true,
                cloudVault: true,
                cloudQuotaMb: 333.33,
                maxDevices: 10,
                skills: ["cloud-vault"],
                modelQuota: 17.33,
            },
        }));
        requestUrlMock.mockResolvedValue(reply(200, { credits: 100 }));

        await agent.refreshStatus();

        expect(get(agent.state).plan).toBe("pro");
        expect(get(agent.state).entitlements?.cloudVault).toBe(true);
    });

    it("服务端返回非法 plan 时保留既有档位", async () => {
        agent.configure("https://api.example.com", "token");
        agent.state.update((s) => ({ ...s, activated: true, plan: "member" }));
        requestUrlMock.mockResolvedValue(reply(200, { credits: 1, plan: "enterprise" }));

        await agent.refreshStatus();

        expect(get(agent.state).plan).toBe("member");
    });

    /**
     * 端到端式：一次纯邮箱登录走完整链路
     * 发码（防枚举文案）→ verify（签发设备 token）→ status（下发 plan/entitlements）。
     * 断言买家立刻会看到的档位标签与权益数值都正确。
     */
    it("端到端：发码 → 邮箱登录 → 档位与权益标签正确；发码文案保持防枚举", async () => {
        requestUrlMock.mockImplementation(async (request: RequestShape) => {
            const url = String(request.url ?? "");
            if (url.endsWith("/api/email/send-code")) {
                return reply(200, {
                    ok: true,
                    message: "若该邮箱可用，验证码已发送",
                    masked: "u***@example.com",
                    ttl_seconds: 300,
                });
            }
            if (url.endsWith("/api/email/verify")) {
                return reply(200, {
                    ok: true,
                    registered: false,
                    account: { account_id: "acc-1", email_masked: "u***@example.com" },
                    cards: [{ card_key: "CARD-PRO" }],
                    session_token: "email-session",
                    token: "email-device-token",
                    card_key: "CARD-PRO",
                });
            }
            if (url.endsWith("/api/status")) {
                return reply(200, {
                    credits: 800,
                    expire_at: 1893456000,
                    model: "DeepSeek-V4-Flash",
                    plan: "pro",
                    entitlements: entitlementsFor("pro"),
                });
            }
            return reply(404, {});
        });

        const sent = await agent.requestEmailCode("user@example.com", "login");
        expect(sent.ok).toBe(true);
        // G7：客户端不替换防枚举文案，也不回显明文邮箱。
        expect(sent.message).toBe("若该邮箱可用，验证码已发送");
        expect(sent.message).not.toContain("user@example.com");

        const login = await agent.loginWithEmail("user@example.com", "123456");
        expect(login.ok).toBe(true);

        const state = get(agent.state);
        expect(state.activated).toBe(true);
        expect(state.plan).toBe("pro");
        expect(PLAN_LABEL[state.plan]).toBe("Pro");
        expect(state.entitlements?.sync).toBe(true);
        expect(state.entitlements?.cloudVault).toBe(true);
        expect(state.entitlements?.schedules).toBe(true);
        expect(state.entitlements?.maxDevices).toBe(10);
        expect(state.entitlements?.cloudQuotaMb).toBeCloseTo(333.33, 2);
        expect(agent.emailAccount).toEqual({
            masked: "u***@example.com",
            cards: [{ card_key: "CARD-PRO" }],
            session: "email-session",
        });
    });
});
