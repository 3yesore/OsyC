import { Modal, Setting, type App, type ButtonComponent } from "@/deps.ts";
import type { LiveSyncActionDescriptor } from "./livesyncSyncActions";

/**
 * 危险 LiveSync 动作的二次确认弹窗。
 *
 * - danger（重建本机）：展示覆盖后果，点「确认执行」即可。
 * - critical（覆盖远端）：额外要求逐字输入确认词（confirmKeyword），
 *   输入匹配前确认按钮保持禁用 —— 这是「最危险动作强提示」的落地方式。
 *
 * 弹窗只负责收集用户决策：onDecision(true) 才会真正执行动作，
 * 关闭（取消 / 点击遮罩 / Esc）一律视为不同意。
 */
export class LiveSyncConfirmModal extends Modal {
    private approved = false;
    private scheduled = false;

    constructor(
        app: App,
        // 只依赖 label / risk / confirmKeyword 三个字段：tweak 对齐动作与五个固定动作
        // 都能复用同一个确认弹窗，不需要伪造一个假的 action id。
        private readonly action: Pick<LiveSyncActionDescriptor, "label" | "risk" | "confirmKeyword">,
        private readonly message: string,
        private readonly onDecision: (approved: boolean) => void
    ) {
        super(app);
    }

    override onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("osyc-livesync-confirm");
        contentEl.createEl("h3", { text: "确认执行：" + this.action.label });
        contentEl.createEl("p", { text: this.message, cls: "ai-account-livesync-alert" });
        if (this.action.risk === "critical") {
            contentEl.createEl("p", {
                text: "该操作不可逆，并会影响所有使用同一远端的设备。",
                cls: "ai-account-livesync-alert",
            });
        } else {
            contentEl.createEl("p", { text: "该操作会重写本机同步数据库。", cls: "ai-account-hint" });
        }

        const keyword = this.action.confirmKeyword;
        let confirmButton: ButtonComponent | null = null;
        if (keyword) {
            const inputSetting = new Setting(contentEl)
                .setName("输入确认词")
                .setDesc("请输入「" + keyword + "」以启用确认按钮。");
            const input = inputSetting.controlEl.createEl("input", {
                type: "text",
                placeholder: keyword,
                attr: { autocomplete: "off", autocapitalize: "none", spellcheck: "false" },
            });
            input.addClass("ai-account-input");
            input.addEventListener("input", () => {
                confirmButton?.setDisabled(input.value.trim() !== keyword);
            });
        }

        new Setting(contentEl)
            .addButton((btn) => btn.setButtonText("取消").setIcon("x").onClick(() => {
                this.approved = false;
                this.close();
            }))
            .addButton((btn) => {
                confirmButton = btn;
                btn.setButtonText("确认执行").setIcon("alert-triangle").setWarning();
                if (keyword) btn.setDisabled(true);
                btn.onClick(() => {
                    this.approved = true;
                    this.close();
                });
            });
    }

    override onClose() {
        this.contentEl.empty();
        this.contentEl.removeClass("osyc-livesync-confirm");
        if (this.scheduled) return;
        this.scheduled = true;
        const decision = this.approved;
        this.onDecision(decision);
    }
}
