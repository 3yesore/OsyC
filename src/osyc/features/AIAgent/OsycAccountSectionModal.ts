import { Modal, Setting, type App } from "@/deps.ts";
import type { CmdAIAgent } from "./CmdAIAgent";
import { renderEmailAccountSection, renderProNamespaceSection } from "./osycAccountSections";

/** 工具中心「账户」页两个入口对应的界面。 */
export type OsycAccountSectionKind = "email" | "pro";

const SECTION_TITLE: Record<OsycAccountSectionKind, string> = {
    email: "邮箱账户",
    pro: "独立同步空间（Pro）",
};

/**
 * 账户区块的承载界面（工具中心「账户」页入口点开后进入）。
 *
 * 只负责把共享的账户区块画出来（{@link renderEmailAccountSection} /
 * {@link renderProNamespaceSection}），与账户详情弹窗是同一份实现，不存在第二套。
 *
 * **显式动作**：打开界面本身不登录、不发验证码、不切换同步空间；邮箱区块里
 * 的开通/登录仍须用户点击，Pro 区块打开时只做一次只读 GET 状态回显。
 */
export class OsycAccountSectionModal extends Modal {
    constructor(
        app: App,
        private agent: CmdAIAgent,
        private kind: OsycAccountSectionKind,
    ) {
        super(app);
    }

    override onOpen(): void {
        this.modalEl.addClass("osyc-account-section-modal");
        this.titleEl.setText(SECTION_TITLE[this.kind]);
        this.render();
    }

    override onClose(): void {
        this.contentEl.empty();
        this.contentEl.removeClass("osyc-account-modal");
        this.modalEl.removeClass("osyc-account-section-modal");
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();
        // 复用账户弹窗的排版基线，入口界面与账户详情外观一致。
        contentEl.addClass("osyc-account-modal");
        const ctx = { app: this.app, agent: this.agent, refresh: () => this.render() };
        if (this.kind === "email") renderEmailAccountSection(contentEl, ctx);
        else renderProNamespaceSection(contentEl, ctx);
        new Setting(contentEl).addButton((btn) =>
            btn.setButtonText("关闭").setIcon("x").setCta().onClick(() => this.close())
        );
    }
}
