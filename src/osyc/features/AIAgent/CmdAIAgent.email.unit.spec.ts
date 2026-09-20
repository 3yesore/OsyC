import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(
    fileURLToPath(new URL("./CmdAIAgent.ts", import.meta.url)),
    "utf8"
);

describe("CmdAIAgent 邮箱账户", () => {
    it("邮箱验证码登录走 /api/email/verify 并直接吃下卡密 token", () => {
        expect(source).toContain('"/api/email/send-code"');
        expect(source).toContain('"/api/email/verify"');
        expect(source).toContain('purpose: "login"');
        expect(source).toContain("device_id: this.deviceId");
        // 登录成功即用后端签发的设备 token 覆盖本地 token
        expect(source).toContain("this.settings.token = res.token");
    });

    it("绑卡凭邮箱会话而不是可猜的 device_id", () => {
        expect(source).toContain('"/api/account/bind-card"');
        expect(source).toContain("session_token: session");
        expect(source).toContain("请先用邮箱验证码登录，再绑定卡密");
    });

    it("邮箱会话只存内存，不写进 settings", () => {
        expect(source).toContain("emailAccount: EmailAccountSession | null = null");
        expect(source).not.toContain("settings.emailAccount");
        expect(source).not.toContain("emailSession:");
    });

    it("邮箱接口错误码有固定用户文案", () => {
        for (const text of [
            "验证码无效或已过期",
            "邮箱会话已失效，请重新验证邮箱",
            "服务端未开启邮箱登录，请联系管理员",
            "验证码邮件发送失败，请稍后再试",
        ]) {
            expect(source).toContain(text);
        }
    });

    it("设备超限时绑卡不整体失败，而是单独提示", () => {
        expect(source).toContain("device_limit_reached");
        expect(source).toContain("本设备已达该卡密上限，请先解绑旧设备");
    });
});
