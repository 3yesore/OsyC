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
        expect(modalSource).toContain('openObsidianSettings(this.app, "synchronisation")');
    });

    it("已激活账户提供重新同步和重新激活卡密入口", () => {
        expect(modalSource).toContain('setName("重新同步")');
        expect(modalSource).toContain('this.agent.refreshSync()');
        expect(modalSource).toContain('setName("重新激活卡密")');
        expect(modalSource).toContain('this.agent.activate(cardKey)');
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
        expect(modalSource.indexOf("renderDeviceSection(contentEl)")).toBeLessThan(
            modalSource.indexOf('setButtonText("关闭")')
        );
    });
});
