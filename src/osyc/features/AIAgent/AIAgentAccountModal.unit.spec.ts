import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const modalSource = readFileSync(
    fileURLToPath(new URL("./AIAgentAccountModal.ts", import.meta.url)),
    "utf8"
);

describe("AI 账户移动端摘要", () => {
    it("积分账本不在插件端自行折算", () => {
        expect(modalSource).not.toContain("creditsYuan");
        expect(modalSource).not.toContain("会员赠送模型额度");
        expect(modalSource).toContain('setName("剩余积分").setDesc(`${state.credits} 分`)');
    });

    it("提供直达同步设置的入口", () => {
        expect(modalSource).toContain('setName("同步设置")');
        // 设置入口一律走 OsyC 设置弹窗：原生设置页只能落到分组列表，用户还得再点一次。
        // （LiveSync 的 "synchronisation" 只是设置页内的分组标题，openTabById 匹配不到，
        // 反而会把用户留在原生设置页。）
        expect(modalSource).toContain("openOsycSettings(this.app)");
        expect(modalSource).not.toContain("openObsidianSettings");
    });

    it("已激活账户提供重新同步和重新激活卡密入口", () => {
        expect(modalSource).toContain('setName("重新同步")');
        expect(modalSource).toContain('this.agent.refreshSync()');
        expect(modalSource).toContain('setName("重新激活卡密")');
        expect(modalSource).toContain('this.agent.activate(cardKey)');
    });

    it("提供充值积分入口（积分包卡密兑换）", () => {
        expect(modalSource).toContain('setName("充值积分")');
        expect(modalSource).toContain("this.agent.recharge(cardKey)");
        // 充值入口与重新激活是两个不同入口：前者加积分，后者换卡密/恢复同步
        expect(modalSource.indexOf('setName("充值积分")')).toBeLessThan(
            modalSource.indexOf('setName("重新激活卡密")')
        );
        // 不显示也不保存卡密原文
        expect(modalSource).toContain('type: "password"');
    });

    it("显示服务器同步覆盖率摘要而不展示远程地址", () => {
        expect(modalSource).toContain("同步覆盖");
        expect(modalSource).not.toContain("setup_uri");
        expect(modalSource).not.toContain("remote_uri");
    });

    it("权益摘要不展示人民币等值额度", () => {
        expect(modalSource).not.toContain("formatModelQuota");
        expect(modalSource).not.toContain("模型额度赠送");
        expect(modalSource).not.toContain("¥");
    });

    it("按权益顺序展示队列优先级和云空间限制", () => {
        expect(modalSource).toContain('setName("队列优先级")');
        expect(modalSource).toContain('setName("Cloud-Vault 空间")');
        expect(modalSource).toContain("ent.cloudQuotaMb");
        expect(modalSource.indexOf('setName("队列优先级")')).toBeLessThan(
            modalSource.indexOf('setName("设备数上限")')
        );
    });

    it("将后端技能 slug 映射为用户可读中文名称", () => {
        expect(modalSource).toContain('"graph-ai": "OC 关系图谱"');
        expect(modalSource).toContain('"theme-custom": "主题自定义"');
        expect(modalSource).toContain("formatSkillName");
        expect(modalSource).toContain('setName("专属 OC 技能")');
        expect(modalSource).toContain('setName("OC 整理任务")');
    });

    it("把关闭操作放在所有账户区块之后", () => {
        const closeAt = modalSource.indexOf('setButtonText("关闭")');
        expect(closeAt).toBeGreaterThan(-1);
        expect(modalSource.indexOf("this.renderDeviceSection(body)")).toBeLessThan(closeAt);
        expect(modalSource.indexOf('this.renderFold(contentEl, "账户操作"')).toBeLessThan(closeAt);
    });

    it("邮箱登录是真实可用流程，不再有禁用预览残留", () => {
        expect(modalSource).toContain("this.renderEmailLogin(body)");
        expect(modalSource).not.toContain("feature_disabled");
        expect(modalSource).not.toContain("邮箱登录将在后续版本开放");
        expect(modalSource).not.toContain("renderEmailLoginTemplate");
        expect(modalSource).toContain('setName("邮箱地址")');
        expect(modalSource).toContain('setName("验证码")');
        expect(modalSource).toContain("this.agent.requestEmailCode");
        expect(modalSource).toContain("this.agent.loginWithEmail");
        // 发码按钮带 60s 倒计时，避免用户连点触发后端限流
        expect(modalSource).toContain("重新发送");
        expect(modalSource).toContain("startCountdown(60)");
    });

    it("提供绑定卡密入口，且邮箱会话只留在内存", () => {
        expect(modalSource).toContain('setName("绑定卡密")');
        expect(modalSource).toContain("this.agent.bindCardToEmail");
        // 会话 token 不落盘：插件里没有持久化邮箱会话的字段
        expect(modalSource).not.toContain("settings.emailSession");
        expect(modalSource).not.toContain("saveData");
    });

    it("账户操作区顺序：邮箱 → 充值 → 重新激活", () => {
        const order = [
            "this.renderEmailLogin(body)",
            "this.renderRecharge(body)",
            "this.renderReactivation(body)",
        ].map((needle) => modalSource.indexOf(needle));
        expect(order.every((idx) => idx > -1)).toBe(true);
        expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    // ── 版面基线：官方分组 + 折叠 ──
    it("分组标题一律使用 Obsidian 官方 setHeading()", () => {
        for (const title of ["权益总览", "同步状态"]) {
            expect(modalSource).toContain(`setName("${title}").setHeading()`);
        }
    });

    it("低频区块用原生 details 折叠而不是平铺", () => {
        expect(modalSource).toContain('createEl("details"');
        expect(modalSource).toContain('createEl("summary"');
        // 设备与自带 Key、账户操作两个低频区默认收起
        expect(modalSource).toContain('this.renderFold(contentEl, "设备与自带 Key", false');
        expect(modalSource).toContain('this.renderFold(contentEl, "账户操作", false');
    });

    // ── 口径回归：BYOK 未启用期间不得出现填写入口 ──
    it("自带 API Key 未启用期间，账户弹窗不得提供填写入口", () => {
        // 口径（2026-09-20）：BYOK 暂不启用，计划 2.# 版本开放。
        // 生产走 AGENT_BACKEND=hermes，它不读 devices.byo_key → 填了不生效。
        // 所以界面既不能出现输入框/保存按钮，也不能出现"不消耗配额"这类承诺。
        expect(modalSource).toContain("自带 API Key（暂未开放）");
        expect(modalSource).toContain(".setDisabled(true)");
        expect(modalSource).not.toContain("不消耗 OsyC 配额");
        expect(modalSource).not.toContain('placeholder: "sk-..."');
        // 断言真实调用点：本文件注释里会提到这两个方法名，不能拿注释当依据
        expect(modalSource).not.toContain("this.agent.saveByoKey");
        expect(modalSource).not.toContain("this.agent.clearByoKey");
        expect(modalSource).not.toContain("已配自带 Key");
    });

    it("首屏顺序为 概览 → 权益 → 同步 → 折叠区", () => {
        const order = [
            'setName("剩余积分")',
            'setName("权益总览").setHeading()',
            'setName("同步状态").setHeading()',
            'this.renderFold(contentEl, "设备与自带 Key"',
        ].map((needle) => modalSource.indexOf(needle));
        expect(order.every((idx) => idx > -1)).toBe(true);
        expect(order).toEqual([...order].sort((a, b) => a - b));
    });
});
