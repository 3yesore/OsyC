import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const modalSource = readFileSync(
    fileURLToPath(new URL("./AIAgentAccountModal.ts", import.meta.url)),
    "utf8"
);
// Pro 区块已抽到共享模块：账户弹窗与工具中心入口共用同一份实现。
const sectionSource = readFileSync(
    fileURLToPath(new URL("./osycAccountSections.ts", import.meta.url)),
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
        // 账户弹窗只做委托，实施细节在共享区块里。
        expect(modalSource).toContain("renderProNamespaceSection(contentEl, this.sectionContext())");
        expect(sectionSource).toContain("export function renderProNamespaceSection");
    });

    it("文案讲清 Pro 专属 / 切换本 vault 同步目标 / 旧空间保留可切回", () => {
        expect(sectionSource).toContain("Pro 专属能力");
        expect(sectionSource).toContain("切换后本 vault 同步到独立空间");
        expect(sectionSource).toContain("旧空间数据保留、可随时切回");
        expect(sectionSource).toContain("切换会改变本 vault 的同步目标");
    });

    it("回显当前空间、是否已开通、用量与只读状态", () => {
        expect(sectionSource).toContain("state.namespace");
        expect(sectionSource).toContain("state.enabled");
        expect(sectionSource).toContain("state.used_mb");
        expect(sectionSource).toContain("state.ready");
        expect(sectionSource).toContain("state.read_only");
        expect(sectionSource).toContain("只读保留");
    });

    it("非 Pro 403 原样展示文案，按钮不得可用", () => {
        // 非 Pro（available=false）→ 按钮保持禁用
        expect(sectionSource).toContain("button?.setDisabled(!state.available)");
        // onClick 内再挡一道：非可用状态不发起开通
        expect(sectionSource).toContain("if (!state?.available) return;");
        // 403 detail 原样呈现
        expect(sectionSource).toContain('state.message || "Pro 会员专属权益"');
        // 初始即禁用，避免未确认状态就能点
        expect(sectionSource).toContain(".setDisabled(true);");
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
        const onClickAt = sectionSource.indexOf("btn.onClick(async () => {");
        const requestAt = sectionSource.indexOf("ctx.agent.requestProNamespace()");
        expect(onClickAt).toBeGreaterThan(-1);
        expect(requestAt).toBeGreaterThan(onClickAt);

        // 打开时只查状态，且状态查询走只读 GET
        expect(sectionSource).toContain("ctx.agent.proNamespaceStatus()");
    });

    it("操作中禁用并显示进行中，完成后刷新界面", () => {
        expect(sectionSource).toContain('btn.setButtonText("正在开通并切换…")');
        expect(sectionSource).toContain("btn.setDisabled(true)");
        expect(sectionSource).toContain("ctx.refresh()");
        expect(sectionSource).toContain("new Notice(result.message)");
        // 刷新回调由宿主提供：账户弹窗传整窗重绘。
        expect(modalSource).toContain("refresh: () => this.onOpen()");
    });

    it("过期（200 + expired/read_only）展示只读保留与续费引导，按钮不整块禁用", () => {
        expect(sectionSource).toContain("isProNamespaceReadOnly");
        expect(sectionSource).toContain("只读保留");
        expect(sectionSource).toContain("续费后即可恢复读写");
        // 过期时按钮保留可点，点击给续费引导，不整块禁用
        expect(sectionSource).toContain("button?.setDisabled(false)");
        expect(sectionSource).toContain("去续费");
        // 非 Pro 仍不可点
        expect(sectionSource).toContain("button?.setDisabled(!state.available)");
    });
});
