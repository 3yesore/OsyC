import { Modal, Setting, type App } from "@/deps.ts";
import { openObsidianSettings } from "@/common/obsidianSettings.ts";
import { setLevelClass, type DeferredPageElement } from "@/modules/features/SettingDialogue/SettingPane.ts";
import { CURRENT_PLUGIN_ID } from "@/osyc/migration/pluginIdentity";
import { renderOsycSettingsPanes } from "./osycSettingsPane";

/**
 * OsyC 设置弹窗。
 *
 * 用 Obsidian 原生 `Modal` 直接承载 OsyC 的偏好设置（连接 / 外观 / 交互 / 诊断）。
 * 以前这里是把用户送进 Obsidian 设置窗口：`openTabById` 只能落到本插件的设置
 * 页，而那页先呈现分组列表，用户还得再点一次才看到 OsyC 的项 —— 这就是「设置
 * 跳转还是有问题」的来源。弹窗没有这个问题：点开就是设置本身。
 *
 * 渲染复用 {@link renderOsycSettingsPanes} 的同一份实现，所以弹窗与原生设置页
 * 永远一致，不会出现两套设置界面各自持有一份状态而互相覆盖 —— 那正是上一版自建
 * 设置弹窗被删除的原因。
 */
export class OsycSettingsModal extends Modal {
    override onOpen(): void {
        this.modalEl.addClass("osyc-settings-modal");
        this.titleEl.setText("OsyC 设置");
        this.render();
    }

    override onClose(): void {
        this.contentEl.empty();
        this.modalEl.removeClass("osyc-settings-modal");
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();
        // 复用原生设置页的排版基线（含移动端的控件尺寸规则）。
        contentEl.addClass("sls-setting");
        renderOsycSettingsPanes(contentEl, {
            addPane: (parentEl, title, _icon, _order, level) => {
                const paneEl = parentEl.createDiv();
                setLevelClass(paneEl, level);
                new Setting(paneEl).setName(title).setHeading().setClass("sls-setting-pane-title");
                return deferred(paneEl);
            },
            addPanel: (parentEl, title, callback, _update, level) => {
                const panelEl = parentEl.createDiv();
                setLevelClass(panelEl, level);
                panelEl.createEl("h4", { text: title, cls: "sls-setting-panel-title" });
                callback?.(panelEl);
                return deferred(panelEl);
            },
        });
        this.renderLiveSyncEntry();
    }

    /**
     * LiveSync 自己的同步配置（远端地址、口令、数据库结构）不在 OsyC 的设置里，
     * 仍然只能在 Obsidian 原生设置页调整。这里留一个明确标注的二级入口，避免
     * 用户以为弹窗里少了东西。
     */
    private renderLiveSyncEntry(): void {
        const footer = this.contentEl.createDiv({ cls: "osyc-settings-modal-footer" });
        new Setting(footer)
            .setName("同步配置（LiveSync）")
            .setDesc("远端地址、口令与数据库结构属于 LiveSync 自身，仍在这里跳转到原生设置调整。")
            .addButton((button) =>
                button
                    .setButtonText("打开原生设置")
                    .setIcon("settings")
                    .onClick(() => {
                        this.close();
                        try {
                            openObsidianSettings(this.app, CURRENT_PLUGIN_ID);
                        } catch (error) {
                            console.error("打开 Obsidian 设置失败", error);
                        }
                    })
            );
    }
}

/** 与原生设置页同形：分组内容在下一个微任务里才渲染。 */
function deferred<T extends HTMLElement>(value: T): DeferredPageElement<T> {
    return {
        then: (callback) => queueMicrotask(() => callback(value)),
    };
}

/**
 * 打开 OsyC 设置弹窗。
 *
 * 所有插件内入口（工具中心、账户弹窗、命令）都走这里，保证只有一条设置路径。
 */
export function openOsycSettings(app: App): OsycSettingsModal {
    const modal = new OsycSettingsModal(app);
    modal.open();
    return modal;
}
