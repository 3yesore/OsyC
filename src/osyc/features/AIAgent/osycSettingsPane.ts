import { Notice, Setting } from "@/deps.ts";
import type { ObsidianLiveSyncSettingTab } from "@/modules/features/SettingDialogue/ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "@/modules/features/SettingDialogue/SettingPane.ts";
import { annotateFontLabel, checkFontAvailability } from "@/osyc/theme/fontAvailability";
import { fontResourceForSource, fontSourceForResource, type FontResource } from "@/osyc/theme/fontResources";
import { THEME_PACK_OPTIONS } from "@/osyc/theme/themePack";
import {
    appearanceToCssVariables,
    FONT_SOURCE_GROUPS,
    fontFamilyForSource,
    fontOptionsForSources,
    parseAppearance,
    THEME_PRESET_OPTIONS,
    type AppearanceSettings,
    type FontSource,
} from "./appearance";
import { getOsycSettingsController, type OsycSettingsController } from "./osycSettingsController";

/**
 * OsyC 偏好设置页。
 *
 * 走 Obsidian 原生设置页（`Setting` + `addPane` 分组标题），不再使用自建弹窗：
 * 弹窗和原生设置各存一份状态，是上一版设置项互相覆盖、以及出现「死代码设置弹窗」的根因。
 * 本页只渲染官方组件，读写全部经 {@link OsycSettingsController} 交回运行时。
 */

const BODY_FONT_OPTIONS = fontOptionsForSources([
    ...FONT_SOURCE_GROUPS.chineseSans,
    ...FONT_SOURCE_GROUPS.chineseSerif,
    ...FONT_SOURCE_GROUPS.chineseModern,
    ...FONT_SOURCE_GROUPS.system,
    ...FONT_SOURCE_GROUPS.latinSans,
    ...FONT_SOURCE_GROUPS.latinSerif,
]);
const CODE_FONT_OPTIONS = fontOptionsForSources(FONT_SOURCE_GROUPS.code);

/** 追加本机已载入字体，并标注每个字体在当前设备上是否真的可用。 */
function fontOptionsWithAvailability(
    options: Record<string, string>,
    resources: readonly FontResource[] = []
): Record<string, string> {
    const fonts = typeof document !== "undefined" && "fonts" in document ? document.fonts : undefined;
    return Object.fromEntries(
        Object.entries(options).map(([source, label]) => {
            if (source === "obsidian" || source === "same") return [source, label];
            const resource = fontResourceForSource(source, resources);
            const family = fontFamilyForSource(source as FontSource, resource?.family);
            return [source, annotateFontLabel(label, checkFontAvailability(family, fonts))];
        })
    );
}

function localFontOptions(resources: readonly FontResource[]): Record<string, string> {
    return Object.fromEntries(
        resources.map((resource) => [fontSourceForResource(resource.id), `本地：${resource.family}`])
    );
}

function appendFontPreview(
    setting: Setting,
    label: string,
    source: FontSource,
    customFamily?: string,
    className = "osyc-font-preview"
): HTMLElement {
    const host = setting.controlEl;
    host.classList.add("osyc-font-control");
    host.setCssStyles({ flexWrap: "wrap" });
    const preview = host.createDiv({ cls: className });
    preview.createSpan({ cls: "osyc-font-preview-label", text: label });
    const sample = preview.createSpan({ cls: "osyc-font-preview-sample", text: "中文样例 Aa 123" });
    sample.setCssStyles({ fontFamily: `${fontFamilyForSource(source, customFamily)} !important` });
    return preview;
}

function updateFontPreview(preview: HTMLElement | null, source: FontSource, customFamily?: string): void {
    const sample = preview?.querySelector<HTMLElement>(".osyc-font-preview-sample");
    if (sample) sample.setCssStyles({ fontFamily: `${fontFamilyForSource(source, customFamily)} !important` });
}

function currentAppearance(controller: OsycSettingsController): AppearanceSettings {
    return controller.snapshot().appearance;
}

function renderConnection(el: HTMLElement, controller: OsycSettingsController): void {
    const status = el.createEl("p", { cls: "setting-item-description osyc-setting-status" });
    const refreshStatus = () => {
        const url = controller.snapshot().serviceUrl;
        status.setText(url ? `当前服务地址：${url}` : "尚未配置服务地址，留空时将无法发送任务。");
    };
    refreshStatus();

    // 边输入边落盘会写很多次文件，这里只在停止输入后提交一次。
    let pending: number | null = null;
    new Setting(el)
        .setName("服务地址")
        .setDesc("后端 API 地址，例如 https://api.example.com。一般由分发方预置，仅自助部署与联调时需要修改。")
        .addText((text) =>
            text
                .setPlaceholder("https://api.example.com")
                .setValue(controller.snapshot().serviceUrl)
                .onChange((value) => {
                    if (pending !== null) window.clearTimeout(pending);
                    pending = window.setTimeout(() => {
                        pending = null;
                        controller.setServiceUrl(value.trim());
                        refreshStatus();
                    }, 800);
                })
        );
}

function renderPreview(container: HTMLElement, controller: OsycSettingsController): () => void {
    const previewEl = container.createDiv({ cls: "osyc-ai-agent osyc-ai-appearance-preview" });
    const previewSizer = previewEl.createDiv({ cls: "osyc-ai-appearance-preview-content" });
    previewSizer.createEl("h2", { text: "笔记内容预览" });
    previewSizer.createEl("p", { text: "这是一段可读的 Markdown 正文，包含" });
    const previewLink = previewSizer.createEl("a", { text: "链接和长文本" });
    previewLink.href = "https://example.com/very/long/path";
    previewSizer.createEl("blockquote", { text: "引用块也会跟随文字颜色和行高。" });
    const previewCode = previewSizer.createEl("pre");
    previewCode.createEl("code", { text: "const note = true;" });
    return () => {
        const appearance = currentAppearance(controller);
        const themeMode = document.body.classList.contains("theme-dark") ? "dark" : "light";
        const resourceUrl = appearance.background.vaultPath
            ? controller.resolveResourceUrl(appearance.background.vaultPath) || undefined
            : undefined;
        for (const [key, value] of Object.entries(
            appearanceToCssVariables(appearance, resourceUrl, themeMode, controller.snapshot().fontResources)
        )) {
            previewEl.setCssProps({ [key]: value });
        }
    };
}

function renderAppearance(el: HTMLElement, controller: OsycSettingsController): void {
    el.createEl("p", {
        text: "字体、字号、颜色和背景会作用于当前 Vault 的 Markdown 笔记。修改会立即预览并保存在本机。",
        cls: "setting-item-description",
    });
    const refreshPreview = renderPreview(el, controller);
    refreshPreview();

    // 恢复默认后需要把已渲染的控件拉回新值；setValue 不会触发 onChange。
    const syncers: (() => void)[] = [];
    const syncAll = () => {
        for (const sync of syncers) sync();
        refreshPreview();
    };
    const updateAppearance = (patch: Partial<AppearanceSettings>) => {
        controller.setAppearance(parseAppearance({ ...currentAppearance(controller), ...patch }));
        refreshPreview();
    };

    new Setting(el)
        .setName("应用到笔记内容")
        .setDesc("开启后，阅读模式、实时预览和源码编辑区都会使用下面的字体、字号、颜色与背景设置。")
        .addToggle((toggle) => {
            toggle
                .setValue(currentAppearance(controller).applyToNotes)
                .onChange((value) => updateAppearance({ applyToNotes: value }));
            syncers.push(() => {
                toggle.setValue(currentAppearance(controller).applyToNotes);
            });
        });

    new Setting(el)
        .setName("外观预设")
        .setDesc(
            "内置预设参考 Minimal、Things、Border、Chinese Writing、Codex Markdown、CodeSplash 和 Image Layouts；仅使用 OsyC 自有样式实现，无远程依赖。"
        )
        .addDropdown((dropdown) => {
            dropdown
                .addOptions(THEME_PRESET_OPTIONS)
                .setValue(currentAppearance(controller).preset)
                .onChange((value) =>
                    updateAppearance({
                        preset: value as AppearanceSettings["preset"],
                        colourPreset: value as AppearanceSettings["colourPreset"],
                    })
                );
            syncers.push(() => {
                dropdown.setValue(currentAppearance(controller).preset);
            });
        });

    new Setting(el)
        .setName("原始主题包")
        .setDesc("从插件内置资源加载原始开源主题；默认关闭，选择后可在下方指定作用范围。")
        .addDropdown((dropdown) => {
            dropdown
                .addOptions(THEME_PACK_OPTIONS)
                .setValue(currentAppearance(controller).themePackId ?? "none")
                .onChange((value) =>
                    updateAppearance({
                        themePackId: value === "none" ? null : (value as AppearanceSettings["themePackId"]),
                    })
                );
            syncers.push(() => {
                dropdown.setValue(currentAppearance(controller).themePackId ?? "none");
            });
        });

    new Setting(el)
        .setName("原始主题作用范围")
        .setDesc("笔记模式经过 OsyC 作用域隔离；原生工作区模式保留原主题的全局效果，可能改变 Obsidian 外壳。")
        .addDropdown((dropdown) => {
            dropdown
                .addOptions({ notes: "笔记内容（安全隔离）", workspace: "原生工作区（完整效果）" })
                .setValue(currentAppearance(controller).themePackScope)
                .onChange((value) =>
                    updateAppearance({ themePackScope: value as AppearanceSettings["themePackScope"] })
                );
            syncers.push(() => {
                dropdown.setValue(currentAppearance(controller).themePackScope);
            });
        });

    let bodyFontPreview: HTMLElement | null = null;
    let headingFontPreview: HTMLElement | null = null;
    const bodyFontSetting = new Setting(el)
        .setName("正文字体")
        .setDesc("中文无衬线、中文衬线和系统字体使用本地字体栈；设备缺失时自动回退。")
        .addDropdown((dropdown) => {
            dropdown
                .addOptions(
                    fontOptionsWithAvailability(
                        { ...BODY_FONT_OPTIONS, ...localFontOptions(controller.snapshot().fontResources) },
                        controller.snapshot().fontResources
                    )
                )
                .setValue(currentAppearance(controller).fontSource)
                .onChange((value) => {
                    updateAppearance({ fontSource: value as AppearanceSettings["fontSource"] });
                    const family = fontResourceForSource(value, controller.snapshot().fontResources)?.family;
                    updateFontPreview(bodyFontPreview, value as FontSource, family);
                    if (currentAppearance(controller).headingFontSource === "same") {
                        updateFontPreview(headingFontPreview, value as FontSource, family);
                    }
                });
            syncers.push(() => {
                dropdown.setValue(currentAppearance(controller).fontSource);
            });
        });
    bodyFontPreview = appendFontPreview(
        bodyFontSetting,
        "正文字体预览",
        currentAppearance(controller).fontSource,
        fontResourceForSource(currentAppearance(controller).fontSource, controller.snapshot().fontResources)?.family
    );

    const headingFontSetting = new Setting(el)
        .setName("标题字体")
        .setDesc("可与正文分开选择；默认跟随正文字体。")
        .addDropdown((dropdown) => {
            dropdown
                .addOptions(
                    fontOptionsWithAvailability(
                        {
                            same: "跟随正文字体",
                            ...BODY_FONT_OPTIONS,
                            ...localFontOptions(controller.snapshot().fontResources),
                        },
                        controller.snapshot().fontResources
                    )
                )
                .setValue(currentAppearance(controller).headingFontSource)
                .onChange((value) => {
                    updateAppearance({ headingFontSource: value as AppearanceSettings["headingFontSource"] });
                    const source = (value === "same" ? currentAppearance(controller).fontSource : value) as FontSource;
                    updateFontPreview(
                        headingFontPreview,
                        source,
                        fontResourceForSource(source, controller.snapshot().fontResources)?.family
                    );
                });
            syncers.push(() => {
                dropdown.setValue(currentAppearance(controller).headingFontSource);
            });
        });
    {
        const appearance = currentAppearance(controller);
        const headingSource =
            appearance.headingFontSource === "same" ? appearance.fontSource : appearance.headingFontSource;
        headingFontPreview = appendFontPreview(
            headingFontSetting,
            "标题字体预览",
            headingSource,
            fontResourceForSource(headingSource, controller.snapshot().fontResources)?.family
        );
    }

    let codeFontPreview: HTMLElement | null = null;
    const codeFontSetting = new Setting(el)
        .setName("代码字体")
        .setDesc("代码块和行内代码独立使用等宽字体，默认跟随系统等宽字体。")
        .addDropdown((dropdown) => {
            dropdown
                .addOptions(
                    fontOptionsWithAvailability(
                        { ...CODE_FONT_OPTIONS, ...localFontOptions(controller.snapshot().fontResources) },
                        controller.snapshot().fontResources
                    )
                )
                .setValue(currentAppearance(controller).codeFontSource)
                .onChange((value) => {
                    updateAppearance({ codeFontSource: value as AppearanceSettings["codeFontSource"] });
                    updateFontPreview(
                        codeFontPreview,
                        value as FontSource,
                        fontResourceForSource(value, controller.snapshot().fontResources)?.family
                    );
                });
            syncers.push(() => {
                dropdown.setValue(currentAppearance(controller).codeFontSource);
            });
        });
    codeFontPreview = appendFontPreview(
        codeFontSetting,
        "代码字体预览",
        currentAppearance(controller).codeFontSource,
        fontResourceForSource(currentAppearance(controller).codeFontSource, controller.snapshot().fontResources)?.family
    );

    const vaultFonts = controller.vaultFonts();
    if (vaultFonts.length > 0) {
        let selectedFont = vaultFonts[0] ?? "";
        new Setting(el)
            .setName("载入本地字体")
            .setDesc("从 Vault 载入字体文件并保存到 OsyC 私有目录；载入后会立即应用。")
            .addDropdown((dropdown) =>
                dropdown
                    .addOptions(Object.fromEntries(vaultFonts.map((path) => [path, path])))
                    .setValue(selectedFont)
                    .onChange((value) => {
                        selectedFont = value;
                    })
            )
            .addButton((button) =>
                button
                    .setButtonText("载入")
                    .setIcon("download")
                    .onClick(() => {
                        void controller.importFont(selectedFont).then((resource) => {
                            if (!resource) return;
                            updateAppearance({
                                fontSource: fontSourceForResource(resource.id) as AppearanceSettings["fontSource"],
                            });
                            new Notice(`字体“${resource.family}”已载入并应用；重新打开设置可在此选择。`);
                        });
                    })
            );
    }

    new Setting(el)
        .setName("正文字号")
        .setDesc("拖动调整字号；点击「跟随主题」交还给 Obsidian 当前主题。")
        .addSlider((slider) =>
            slider
                .setLimits(13, 24, 1)
                .setValue(currentAppearance(controller).fontSize ?? 16)
                .onChange((value) => updateAppearance({ fontSize: value }))
        )
        .addButton((button) =>
            button
                .setButtonText("跟随主题")
                .setIcon("rotate-ccw")
                .onClick(() => {
                    updateAppearance({ fontSize: null });
                    syncAll();
                })
        );

    new Setting(el)
        .setName("行高")
        .setDesc("拖动调整阅读舒适度；点击「跟随主题」交还给 Obsidian 当前主题。")
        .addSlider((slider) =>
            slider
                .setLimits(1.3, 2.2, 0.1)
                .setValue(currentAppearance(controller).lineHeight ?? 1.5)
                .onChange((value) => updateAppearance({ lineHeight: Math.round(value * 10) / 10 }))
        )
        .addButton((button) =>
            button
                .setButtonText("跟随主题")
                .setIcon("rotate-ccw")
                .onClick(() => {
                    updateAppearance({ lineHeight: null });
                    syncAll();
                })
        );

    const advanced = el.createEl("details", { cls: "osyc-ai-appearance-advanced" });
    advanced.open = typeof window === "undefined" || window.innerWidth > 720;
    advanced.createEl("summary", { text: "更多颜色与背景" });
    const advancedContent = advanced.createDiv({ cls: "osyc-ai-appearance-advanced-content" });

    new Setting(advancedContent).setName("内容密度").addDropdown((dropdown) => {
        dropdown
            .addOptions({ minimal: "极简", compact: "紧凑", comfortable: "舒适", spacious: "宽松" })
            .setValue(currentAppearance(controller).density)
            .onChange((value) => updateAppearance({ density: value as AppearanceSettings["density"] }));
        syncers.push(() => {
            dropdown.setValue(currentAppearance(controller).density);
        });
    });

    new Setting(advancedContent)
        .setName("文字颜色")
        .setDesc("点击色块选择，重置后跟随预设")
        .addColorPicker((picker) => {
            picker.setValue(currentAppearance(controller).colourOverrides.text ?? "#ffffff").onChange((value) => {
                updateAppearance({
                    colourOverrides: { ...currentAppearance(controller).colourOverrides, text: value },
                });
            });
            syncers.push(() => {
                picker.setValue(currentAppearance(controller).colourOverrides.text ?? "#ffffff");
            });
        })
        .addButton((button) =>
            button
                .setButtonText("跟随预设")
                .setIcon("rotate-ccw")
                .onClick(() => {
                    updateAppearance({
                        colourOverrides: { ...currentAppearance(controller).colourOverrides, text: null },
                    });
                    syncAll();
                })
        );

    new Setting(advancedContent)
        .setName("强调色")
        .setDesc("点击色块选择，重置后跟随预设")
        .addColorPicker((picker) => {
            picker.setValue(currentAppearance(controller).colourOverrides.accent ?? "#5aa9e6").onChange((value) => {
                updateAppearance({
                    colourOverrides: { ...currentAppearance(controller).colourOverrides, accent: value },
                });
            });
            syncers.push(() => {
                picker.setValue(currentAppearance(controller).colourOverrides.accent ?? "#5aa9e6");
            });
        })
        .addButton((button) =>
            button
                .setButtonText("跟随预设")
                .setIcon("rotate-ccw")
                .onClick(() => {
                    updateAppearance({
                        colourOverrides: { ...currentAppearance(controller).colourOverrides, accent: null },
                    });
                    syncAll();
                })
        );

    new Setting(advancedContent).setName("背景模式").addDropdown((dropdown) => {
        dropdown
            .addOptions({ theme: "跟随主题", solid: "纯色", image: "Vault 本地图片" })
            .setValue(currentAppearance(controller).background.mode)
            .onChange((value) =>
                updateAppearance({
                    background: {
                        ...currentAppearance(controller).background,
                        mode: value as AppearanceSettings["background"]["mode"],
                    },
                })
            );
        syncers.push(() => {
            dropdown.setValue(currentAppearance(controller).background.mode);
        });
    });

    const vaultImages = controller.vaultImages();
    if (vaultImages.length > 0) {
        new Setting(advancedContent)
            .setName("背景图片")
            .setDesc("仅列出当前 Vault 的图片，不会上传")
            .addDropdown((dropdown) => {
                dropdown
                    .addOption("", "不使用图片")
                    .addOptions(Object.fromEntries(vaultImages.map((path) => [path, path])))
                    .setValue(currentAppearance(controller).background.vaultPath ?? "")
                    .onChange((value) =>
                        updateAppearance({
                            background: {
                                ...currentAppearance(controller).background,
                                mode: value ? "image" : "theme",
                                vaultPath: value || null,
                                opacity:
                                    value && currentAppearance(controller).background.opacity === 0
                                        ? 0.24
                                        : currentAppearance(controller).background.opacity,
                            },
                        })
                    );
                syncers.push(() => {
                    dropdown.setValue(currentAppearance(controller).background.vaultPath ?? "");
                });
            });
    }

    new Setting(advancedContent)
        .setName("背景透明度")
        .setDesc("拖动调整背景可见程度")
        .addSlider((slider) =>
            slider
                .setLimits(0, 1, 0.05)
                .setValue(currentAppearance(controller).background.opacity)
                .onChange((value) =>
                    updateAppearance({ background: { ...currentAppearance(controller).background, opacity: value } })
                )
        );

    new Setting(advancedContent)
        .setName("恢复默认外观")
        .setDesc("把上面所有外观选项还原为 OsyC 默认值。")
        .addButton((button) =>
            button
                .setButtonText("恢复默认")
                .setIcon("rotate-ccw")
                .setWarning()
                .onClick(() => {
                    controller.resetAppearance();
                    syncAll();
                    new Notice("外观已恢复默认");
                })
        );
}

function renderInteraction(el: HTMLElement, controller: OsycSettingsController): void {
    new Setting(el)
        .setName("悬浮球常驻显示")
        .setDesc("关闭后不再显示悬浮球，可改用 Obsidian 原生底部栏按钮或三击打开 OC 对话页。")
        .addToggle((toggle) =>
            toggle.setValue(controller.snapshot().showBall).onChange((value) => controller.setShowBall(value))
        );

    new Setting(el)
        .setName("移动端三击打开 OC")
        .setDesc("手机上连续点三下屏幕任意位置，快速打开 OC 对话页。容易误触可关闭。")
        .addToggle((toggle) =>
            toggle.setValue(controller.snapshot().tripleTap).onChange((value) => controller.setTripleTap(value))
        );

    new Setting(el)
        .setName("发送时附带当前 Markdown 笔记")
        .setDesc("仅在你点击发送时提交当前 Markdown 正文和编辑位置，不会持续上传。")
        .addToggle((toggle) =>
            toggle.setValue(controller.snapshot().includeActiveNoteContext).onChange(async (value) => {
                const applied = await controller.setIncludeActiveNoteContext(value);
                if (!applied) toggle.setValue(false);
            })
        );
}

function renderDiagnostics(el: HTMLElement, controller: OsycSettingsController): void {
    new Setting(el)
        .setName("版本")
        .setDesc("当前安装的 OsyC 插件版本。")
        .addExtraButton((button) =>
            button
                .setIcon("info")
                .setTooltip(controller.pluginVersion())
                .onClick(() => new Notice(`OsyC ${controller.pluginVersion()}`))
        );

    new Setting(el)
        .setName("运行日志")
        .setDesc("仅保留最近 200 条运行日志，内容已自动脱敏，不会写入笔记库。")
        .addButton((button) =>
            button
                .setButtonText("打开日志")
                .setIcon("file-text")
                .onClick(() => controller.openLog())
        );

    new Setting(el)
        .setName("脱敏诊断报告")
        .setDesc("复制当前运行环境与日志，便于反馈问题时一并提交。")
        .addButton((button) =>
            button
                .setButtonText("复制报告")
                .setIcon("copy")
                .onClick(() => {
                    void controller.copyDiagnostics();
                })
        );
}

/**
 * 渲染 OsyC 偏好设置的四个分组。
 *
 * 原生设置页与设置弹窗（`OsycSettingsModal`）共用这一份实现：两套设置界面各持
 * 一份状态、互相覆盖，正是上一版自建设置弹窗被删除的原因。本函数不依赖 `this`，
 * 因此两个宿主都能直接调用。
 */
export function renderOsycSettingsPanes(paneEl: HTMLElement, { addPane }: PageFunctions): void {
    const controller = getOsycSettingsController();
    if (!controller) {
        void addPane(paneEl, "OsyC", "🧠", 10).then((el) => {
            el.createEl("p", {
                text: "OsyC 服务尚未就绪，请稍后重新打开设置页。",
                cls: "setting-item-description",
            });
        });
        return;
    }
    void addPane(paneEl, "连接", "🔌", 11).then((el) => renderConnection(el, controller));
    void addPane(paneEl, "外观", "🎨", 12).then((el) => renderAppearance(el, controller));
    void addPane(paneEl, "交互", "🖱️", 13).then((el) => renderInteraction(el, controller));
    void addPane(paneEl, "诊断", "🧰", 14).then((el) => renderDiagnostics(el, controller));
}

/**
 * 原生设置页入口。
 *
 * `SettingsPageRenderer` 的签名带 `this: ObsidianLiveSyncSettingTab`，而本页面
 * 从不使用 `this`（渲染全部经 `OsycSettingsController` 回到运行时），所以这里只是
 * 一个薄适配层，把调用转给共享实现。
 */
export function paneOsyc(this: ObsidianLiveSyncSettingTab, paneEl: HTMLElement, functions: PageFunctions): void {
    void this;
    renderOsycSettingsPanes(paneEl, functions);
}
