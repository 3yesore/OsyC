import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const modalSource = readFileSync(
    fileURLToPath(new URL("./AIAgentAccountModal.ts", import.meta.url)),
    "utf8"
);

describe("账户弹窗 · Pro 独立同步空间", () => {
    it("在账户操作折叠区渲染独立同步空间区块", () => {
        const foldAt = modalSource.indexOf('this.renderFold(contentEl, "账户操作"');
        const renderAt = modalSource.indexOf("this.renderProNamespace(body)");
        const closeAt = modalSource.indexOf('setButtonText("关闭")');
        expect(foldAt).toBeGreaterThan(-1);
        expect(renderAt).toBeGreaterThan(foldAt);
        expect(closeAt).toBeGreaterThan(renderAt);
    });

    it("文案讲清 Pro 专属 / 切换本 vault 同步目标 / 旧空间保留可切回", () => {
        expect(modalSource).toContain("Pro 专属能力");
        expect(modalSource).toContain("切换后本 vault 同步到独立空间");
        expect(modalSource).toContain("旧空间数据保留、可随时切回");
        expect(modalSource).toContain("切换会改变本 vault 的同步目标");
    });

    it("回显当前空间、是否已开通、用量与只读状态", () => {
        expect(modalSource).toContain("state.namespace");
        expect(modalSource).toContain("state.enabled");
        expect(modalSource).toContain("state.used_mb");
        expect(modalSource).toContain("state.ready");
        expect(modalSource).toContain("state.read_only");
        expect(modalSource).toContain("只读保留");
    });

    it("非 Pro 403 原样展示文案，按钮不得可用", () => {
        // 非 Pro（available=false）→ 按钮保持禁用
        expect(modalSource).toContain("button?.setDisabled(!state.available)");
        // onClick 内再挡一道：非可用状态不发起开通
        expect(modalSource).toContain("if (!state?.available) return;");
        // 403 detail 原样呈现
        expect(modalSource).toContain('state.message || "Pro 会员专属权益"');
        // 初始即禁用，避免未确认状态就能点
        expect(modalSource).toContain(".setDisabled(true);");
    });

    it("只有用户点击才切换：打开弹窗只做 GET 状态回显", () => {
        const openAt = modalSource.indexOf("override onOpen()");
        const openEnd = modalSource.indexOf("private renderFold(");
        expect(openAt).toBeGreaterThan(-1);
        expect(openEnd).toBeGreaterThan(openAt);
        const openBlock = modalSource.slice(openAt, openEnd);
        expect(openBlock).toContain("this.renderProNamespace(body)");
        expect(openBlock).not.toContain("requestProNamespace");

        // 开通调用只出现在按钮 onClick 闭包里
        const onClickAt = modalSource.indexOf("btn.onClick(async () => {");
        const requestAt = modalSource.indexOf("this.agent.requestProNamespace()");
        expect(onClickAt).toBeGreaterThan(-1);
        expect(requestAt).toBeGreaterThan(onClickAt);

        // 打开时只查状态，且状态查询走只读 GET
        expect(modalSource).toContain("this.agent.proNamespaceStatus()");
    });

    it("操作中禁用并显示进行中，完成后刷新弹窗", () => {
        expect(modalSource).toContain('btn.setButtonText("正在开通并切换…")');
        expect(modalSource).toContain("btn.setDisabled(true)");
        expect(modalSource).toContain("this.onOpen()");
        expect(modalSource).toContain("new Notice(result.message)");
    });
});
