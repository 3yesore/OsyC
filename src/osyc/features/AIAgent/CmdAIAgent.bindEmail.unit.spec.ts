import { beforeEach, describe, expect, it, vi } from "vitest";

const requestUrlMock = vi.fn();
vi.mock("@/deps.ts", () => ({
    requestUrl: (...args: unknown[]) => requestUrlMock(...args),
}));

import { CmdAIAgent, EMAIL_DEVICE_LIMIT_MESSAGE, readEmailErrorDetail } from "./CmdAIAgent";

interface RequestShape {
    url?: unknown;
    method?: unknown;
    body?: unknown;
    headers?: Record<string, string>;
}

const reply = (status: number, data: unknown) => ({ status, json: data });

function lastRequest(): RequestShape {
    const calls = requestUrlMock.mock.calls;
    return calls[calls.length - 1][0] as RequestShape;
}

function sentBody(): Record<string, unknown> {
    return JSON.parse(String(lastRequest().body)) as Record<string, unknown>;
}

describe("CmdAIAgent · 卡密 → 邮箱绑定（G1）", () => {
    let agent: CmdAIAgent;

    beforeEach(() => {
        requestUrlMock.mockReset();
        agent = new CmdAIAgent();
        agent.deviceId = "test-device";
        agent.configure("https://api.example.com", "card-token");
    });

    it("requestEmailCode 默认发 purpose=login，绑定邮箱时显式发 purpose=bind", async () => {
        requestUrlMock.mockResolvedValue(reply(200, { ok: true }));

        await agent.requestEmailCode("user@example.com");
        expect(sentBody()).toEqual({ email: "user@example.com", purpose: "login" });

        await agent.requestEmailCode("user@example.com", "bind");
        expect(sentBody()).toEqual({ email: "user@example.com", purpose: "bind" });
        expect(String(lastRequest().url)).toContain("/api/email/send-code");
    });

    it("bindEmailToAccount 用当前卡密 Bearer token POST /api/account/bind-email", async () => {
        requestUrlMock.mockResolvedValue(
            reply(200, {
                ok: true,
                message: "邮箱已绑定",
                email_masked: "u***@example.com",
                cards: [{ card_key: "TEST-CARD" }],
            })
        );

        const result = await agent.bindEmailToAccount("user@example.com", "123456");

        expect(result).toEqual({ ok: true, message: "邮箱已绑定" });
        const request = lastRequest();
        expect(request.method).toBe("POST");
        expect(String(request.url)).toContain("/api/account/bind-email");
        expect(sentBody()).toEqual({ email: "user@example.com", code: "123456" });
        expect(request.headers?.Authorization).toBe("Bearer card-token");
        // 只留只读回显，绝不伪造邮箱登录会话（bind-email 不签发 session_token）
        expect(agent.emailAccount).toBeNull();
        expect(agent.emailBindSummary).toContain("u***@example.com");
    });

    it("已登录同一邮箱时，绑定成功刷新内存会话的掩码与卡密", async () => {
        agent.emailAccount = { masked: "old***@example.com", cards: [], session: "email-session" };
        requestUrlMock.mockResolvedValue(
            reply(200, { ok: true, email_masked: "new***@example.com", cards: [{ card_key: "TEST-CARD" }] })
        );

        const result = await agent.bindEmailToAccount("user@example.com", "123456");

        expect(result.ok).toBe(true);
        expect(agent.emailAccount).toEqual({
            masked: "new***@example.com",
            cards: [{ card_key: "TEST-CARD" }],
            session: "email-session",
        });
    });

    it("未激活卡密时不发绑定请求", async () => {
        agent.configure("https://api.example.com", "");

        const result = await agent.bindEmailToAccount("user@example.com", "123456");

        expect(result.ok).toBe(false);
        expect(result.message).toContain("请先激活卡密");
        expect(requestUrlMock).not.toHaveBeenCalled();
    });

    it("bind-email 失败时优先回显服务端 detail（400/401/403/429/501）", async () => {
        const cases: Array<[number, string]> = [
            [400, "验证码无效或已过期"],
            [401, "邮箱会话已失效，请重新验证邮箱"],
            [403, "本设备已达该卡密上限，请先解绑旧设备"],
            [429, "请求过于频繁，请稍后再试"],
            [501, "邮箱功能未启用，请联系管理员"],
        ];
        for (const [status, detail] of cases) {
            requestUrlMock.mockResolvedValue(reply(status, { detail }));
            const result = await agent.bindEmailToAccount("user@example.com", "123456");
            expect(result).toEqual({ ok: false, message: detail });
        }
    });

    it("服务端 detail 缺失或为空白时回落到状态码固定文案", async () => {
        requestUrlMock.mockResolvedValue(reply(400, {}));
        expect(await agent.bindEmailToAccount("user@example.com", "123456")).toEqual({
            ok: false,
            message: "验证码无效或已过期",
        });

        requestUrlMock.mockResolvedValue(reply(501, { detail: "   " }));
        expect(await agent.bindEmailToAccount("user@example.com", "123456")).toEqual({
            ok: false,
            message: "服务端未开启邮箱登录，请联系管理员",
        });
    });

    it("detail 回显做控制字符折叠与 240 字截断", async () => {
        requestUrlMock.mockResolvedValue(reply(400, { detail: "  a\n\nb\tc  " + "x".repeat(500) }));
        const result = await agent.bindEmailToAccount("user@example.com", "123456");
        expect(result.message.length).toBe(240);
        expect(result.message.startsWith("a b c")).toBe(true);
        expect(result.message).not.toContain("\n");
        expect(result.message).not.toContain("\t");
    });

    it("readEmailErrorDetail 只接受字符串 detail/message/error", () => {
        expect(readEmailErrorDetail({ detail: " 邮箱格式不正确 " })).toBe("邮箱格式不正确");
        expect(readEmailErrorDetail({ message: "x" })).toBe("x");
        expect(readEmailErrorDetail({ error: "y" })).toBe("y");
        expect(readEmailErrorDetail({ detail: 42 })).toBeNull();
        expect(readEmailErrorDetail(null)).toBeNull();
        expect(readEmailErrorDetail([])).toBeNull();
    });

    it("发码失败时能单独提示「邮箱格式不正确」而不是笼统的验证码文案", async () => {
        requestUrlMock.mockResolvedValue(reply(400, { detail: "邮箱格式不正确" }));
        const result = await agent.requestEmailCode("bad", "bind");
        expect(result).toEqual({ ok: false, message: "邮箱格式不正确" });
    });

    it("邮箱验证码登录同样优先回显服务端 detail", async () => {
        requestUrlMock.mockResolvedValue(reply(400, { detail: "验证码已被使用" }));
        const result = await agent.loginWithEmail("user@example.com", "123456");
        expect(result).toEqual({ ok: false, message: "验证码已被使用" });
    });

    it("发码成功只回显服务端防枚举文案，不改写、不回显明文邮箱（G7）", async () => {
        requestUrlMock.mockResolvedValue(
            reply(200, { ok: true, message: "若该邮箱可用，验证码已发送", masked: "u***@example.com", ttl_seconds: 300 })
        );
        const result = await agent.requestEmailCode("user@example.com", "login");
        expect(result).toEqual({ ok: true, message: "若该邮箱可用，验证码已发送" });
        expect(result.message).not.toContain("user@example.com");
    });

    it("服务端漏发 message 时用中性防枚举兜底，仍不回显邮箱（G7）", async () => {
        requestUrlMock.mockResolvedValue(reply(200, { ok: true }));
        const result = await agent.requestEmailCode("user@example.com", "login");
        expect(result).toEqual({ ok: true, message: "若该邮箱可用，验证码已发送" });
    });

    it("两个绑定方向的设备超限收敛到同一句文案（G5）", async () => {
        // 方向「邮箱 → 卡密」：200 + device_limit_reached，服务端文案带前缀也不采用
        agent.emailAccount = { masked: "u***@example.com", cards: [], session: "email-session" };
        requestUrlMock.mockResolvedValue(
            reply(200, {
                ok: true,
                device_limit_reached: true,
                message: "卡密已并入账户，但本设备已达该卡密上限，请先解绑旧设备",
            })
        );
        const reverse = await agent.bindCardToEmail("TEST-CARD");
        expect(reverse).toEqual({ ok: false, message: EMAIL_DEVICE_LIMIT_MESSAGE });

        // 方向「卡密 → 邮箱」：服务端若下发同一机器可读信号，也必须同一文案
        agent.emailAccount = null;
        agent.configure("https://api.example.com", "card-token");
        requestUrlMock.mockResolvedValue(
            reply(200, { ok: true, device_limit_reached: true, message: "本设备已达上限" })
        );
        const forward = await agent.bindEmailToAccount("user@example.com", "123456");
        expect(forward).toEqual({ ok: false, message: EMAIL_DEVICE_LIMIT_MESSAGE });
    });

    it("verify 403 无 detail 时回落到统一设备上限文案（G5）", async () => {
        requestUrlMock.mockResolvedValue(reply(403, {}));
        const result = await agent.loginWithEmail("user@example.com", "123456");
        expect(result).toEqual({ ok: false, message: EMAIL_DEVICE_LIMIT_MESSAGE });
    });
});
