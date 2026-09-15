import { Modal, Notice, Platform, Setting, TFile, requestUrl, type App } from "@/deps.ts";
import type { WorkspaceLeaf } from "@/deps";
import { AIAgentPaneView, VIEW_TYPE_AI_AGENT } from "@/osyc/features/AIAgent/AIAgentPaneView";
import { AIAgentFloating } from "@/osyc/features/AIAgent/AIAgentFloating";
import { AIAgentAccountModal } from "@/osyc/features/AIAgent/AIAgentAccountModal";
import { AIAgentToolsModal } from "@/osyc/features/AIAgent/AIAgentToolsModal";
import { CmdAIAgent } from "@/osyc/features/AIAgent/CmdAIAgent";
import type { AISnippet, ArtifactMetadata } from "@/osyc/features/AIAgent/CmdAIAgent";
import { get, writable } from "svelte/store";
import type { LiveSyncCore } from "@/main";
import type { NecessaryServices } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import { decodeSettingsFromSetupURI } from "@vrtmrz/livesync-commonlib/compat/API/processSetting";
import { buildSetupPatch, sanitizeLivesyncPatch } from "@/osyc/features/AIAgent/livesyncPatch";
import { parseAIAgentPersisted, PERSISTED_VERSION, type AIAgentPersisted } from "@/osyc/serviceFeatures/aiAgentPersistence";
import { appearanceToCssVariables, DEFAULT_APPEARANCE, FONT_SOURCE_GROUPS, fontFamilyForSource, fontOptionsForSources, parseAppearance, THEME_PRESET_OPTIONS, type AppearanceSettings, type FontSource } from "@/osyc/features/AIAgent/appearance";
import { annotateFontLabel, checkFontAvailability } from "@/osyc/theme/fontAvailability";
import { applyThemeProfileStyles, migrateAppearanceToThemeProfile } from "@/osyc/theme/themeModel";
import { syncMarkdownThemeScope } from "@/osyc/theme/themeScope";
import { FONT_RESOURCE_DIR, createFontFaceDescriptor, fontResourceForSource, fontResourcePath, fontSourceForResource, type FontResource } from "@/osyc/theme/fontResources";
import { applyThemePackScope, THEME_PACK_OPTIONS, themePackForId } from "@/osyc/theme/themePack";
import { osycLogger } from "@/osyc/serviceFeatures/osycLogger";
import { uploadErrorReport } from "@/osyc/features/AIAgent/diagnosticsUpload";
import { AnnouncementClient, type Announcement } from "@/osyc/features/AIAgent/announcements";

declare const MANIFEST_VERSION: string | undefined;

/** 存放在 vault 配置目录下，不参与同步，避免把凭据写进笔记库 */
const CONFIG_FILE_NAME = "livesync-aiagent.json";

const BODY_FONT_OPTIONS = fontOptionsForSources([
    ...FONT_SOURCE_GROUPS.chineseSans,
    ...FONT_SOURCE_GROUPS.chineseSerif,
    ...FONT_SOURCE_GROUPS.chineseModern,
    ...FONT_SOURCE_GROUPS.system,
    ...FONT_SOURCE_GROUPS.latinSans,
    ...FONT_SOURCE_GROUPS.latinSerif,
]);
const CODE_FONT_OPTIONS = fontOptionsForSources(FONT_SOURCE_GROUPS.code);

function fontOptionsWithAvailability(options: Record<string, string>, resources: readonly FontResource[] = []): Record<string, string> {
    const fonts = typeof document !== "undefined" && "fonts" in document ? document.fonts : undefined;
    return Object.fromEntries(Object.entries(options).map(([source, label]) => {
        if (source === "obsidian" || source === "same") return [source, label];
        const resource = fontResourceForSource(source, resources);
        const family = fontFamilyForSource(source as FontSource, resource?.family);
        return [source, annotateFontLabel(label, checkFontAvailability(family, fonts))];
    }));
}

function appendFontPreview(setting: Setting, label: string, source: FontSource, customFamily?: string, className = "osyc-font-preview"): HTMLElement {
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

class OsyCLogModal extends Modal {
    constructor(app: App, private readonly logger = osycLogger) {
        super(app);
    }

    override onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h3", { text: "OsyC 日志" });
        contentEl.createEl("p", { text: "仅保留最近 200 条运行日志，内容已自动脱敏，不会写入笔记库。" });
        const pre = contentEl.createEl("pre", { cls: "osyc-log-output" });
        pre.setText(this.logger.report());
        const actions = contentEl.createDiv({ cls: "osyc-log-actions" });
        const copy = actions.createEl("button", { text: "复制日志" });
        copy.addEventListener("click", () => {
            void navigator.clipboard
                .writeText(this.logger.report())
                .then(() => new Notice("OsyC 日志已复制"))
                .catch(() => new Notice("复制失败，请检查剪贴板权限"));
        });
        const clear = actions.createEl("button", { text: "清空日志" });
        clear.addEventListener("click", () => {
            this.logger.clear();
            pre.setText(this.logger.report());
        });
        const close = actions.createEl("button", { text: "关闭" });
        close.addEventListener("click", () => this.close());
    }
}

function createDeviceId(): string {
    const bytes = new Uint8Array(16);
    const c = typeof window === "undefined" ? undefined : window.crypto;
    if (c && typeof c.getRandomValues === "function") {
        c.getRandomValues(bytes);
    } else {
        for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 服务地址配置弹窗。
 *
 * 一般用户由分发方预置地址后不会看到这里；仅自助部署与联调时需要。
 */
/** @deprecated Settings are opened through Obsidian's native settings page. */
export class AIAgentSettingModal extends Modal {
    value: string;
    onSave: (value: string) => void;
    tripleTap: boolean;
    onTripleTapChange: (value: boolean) => void;
    showBall: boolean;
    onShowBallChange: (value: boolean) => void;
    includeActiveNoteContext: boolean;
    onIncludeActiveNoteContextChange: (value: boolean) => Promise<boolean>;
    appearance: AppearanceSettings;
    onAppearanceChange: (value: AppearanceSettings) => void;
    vaultImages: string[];
    vaultFonts: string[];
    fontResources: FontResource[];
    onImportFont: (path: string) => Promise<FontResource | null>;
    private previewEl: HTMLElement | null = null;
    constructor(
        app: App,
        value: string,
        onSave: (value: string) => void,
        tripleTap: boolean,
        onTripleTapChange: (value: boolean) => void,
        showBall: boolean,
        onShowBallChange: (value: boolean) => void,
        includeActiveNoteContext: boolean,
        onIncludeActiveNoteContextChange: (value: boolean) => Promise<boolean>,
        appearance: AppearanceSettings,
        onAppearanceChange: (value: AppearanceSettings) => void,
        vaultImages: string[],
        vaultFonts: string[],
        fontResources: FontResource[],
        onImportFont: (path: string) => Promise<FontResource | null>
    ) {
        super(app);
        this.value = value;
        this.onSave = onSave;
        this.tripleTap = tripleTap;
        this.onTripleTapChange = onTripleTapChange;
        this.showBall = showBall;
        this.onShowBallChange = onShowBallChange;
        this.includeActiveNoteContext = includeActiveNoteContext;
        this.onIncludeActiveNoteContextChange = onIncludeActiveNoteContextChange;
        this.appearance = appearance;
        this.onAppearanceChange = onAppearanceChange;
        this.vaultImages = vaultImages;
        this.vaultFonts = vaultFonts;
        this.fontResources = fontResources;
        this.onImportFont = onImportFont;
    }
    override onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h3", { text: "OsyC 设置" });
        contentEl.createEl("h4", { text: "连接", cls: "osyc-ai-setting-section" });
        new Setting(contentEl)
            .setName("服务地址")
            .setDesc("后端 API 地址，例如 https://api.example.com 。留空时不能发送任务。")
            .addText((text) =>
                text
                    .setPlaceholder("https://api.example.com")
                    .setValue(this.value)
                    .onChange((v) => (this.value = v.trim()))
            );
        contentEl.createEl("h4", { text: "笔记内容外观", cls: "osyc-ai-setting-section" });
        contentEl.createEl("p", {
            text: "字体、字号、颜色和背景会作用于当前 Vault 的 Markdown 笔记。修改会立即预览并保存在本机。",
            cls: "setting-item-description",
        });
        this.previewEl = contentEl.createDiv({ cls: "osyc-ai-agent osyc-ai-appearance-preview" });
        const previewSizer = this.previewEl.createDiv({ cls: "osyc-ai-appearance-preview-content" });
        previewSizer.createEl("h2", { text: "笔记内容预览" });
        previewSizer.createEl("p", { text: "这是一段可读的 Markdown 正文，包含" });
        const previewLink = previewSizer.createEl("a", { text: "链接和长文本" });
        previewLink.href = "https://example.com/very/long/path";
        previewSizer.createEl("blockquote", { text: "引用块也会跟随文字颜色和行高。" });
        const previewCode = previewSizer.createEl("pre");
        previewCode.createEl("code", { text: "const note = true;" });
        const refreshPreview = () => {
            if (!this.previewEl) return;
            const themeMode = document.body.classList.contains("theme-dark") ? "dark" : "light";
            const backgroundFile = this.appearance.background.vaultPath
                ? this.app.vault.getAbstractFileByPath(this.appearance.background.vaultPath)
                : null;
            const resourceUrl = backgroundFile instanceof TFile ? this.app.vault.getResourcePath(backgroundFile) : undefined;
            for (const [key, value] of Object.entries(appearanceToCssVariables(this.appearance, resourceUrl, themeMode, this.fontResources))) {
                this.previewEl.setCssProps({ [key]: value });
            }
        };
        refreshPreview();
        const updateAppearance = (patch: Partial<AppearanceSettings>) => {
            this.appearance = parseAppearance({ ...this.appearance, ...patch });
            this.onAppearanceChange(this.appearance);
            refreshPreview();
        };
        contentEl.createEl("h5", { text: "快速调整", cls: "osyc-ai-setting-subsection" });
        new Setting(contentEl)
            .setName("应用到笔记内容")
            .setDesc("开启后，阅读模式、实时预览和源码编辑区都会使用下面的字体、字号、颜色与背景设置。")
            .addToggle((toggle) => toggle
                .setValue(this.appearance.applyToNotes)
                .onChange((value) => updateAppearance({ applyToNotes: value })));
        new Setting(contentEl)
            .setName("外观预设")
            .setDesc("内置预设参考 Minimal、Things、Border、Chinese Writing、Codex Markdown、CodeSplash 和 Image Layouts；仅使用 OsyC 自有样式实现，无远程依赖。")
            .addDropdown((dropdown) => dropdown
                .addOptions(THEME_PRESET_OPTIONS)
                .setValue(this.appearance.preset)
                .onChange((value) => updateAppearance({ preset: value as AppearanceSettings["preset"], colourPreset: value as AppearanceSettings["colourPreset"] })));
        new Setting(contentEl)
            .setName("原始主题包")
            .setDesc("从插件内置资源加载原始开源主题；默认关闭，选择后可在下方指定作用范围。")
            .addDropdown((dropdown) => dropdown
                .addOptions(THEME_PACK_OPTIONS)
                .setValue(this.appearance.themePackId ?? "none")
                .onChange((value) => updateAppearance({ themePackId: value === "none" ? null : value as AppearanceSettings["themePackId"] })));
        new Setting(contentEl)
            .setName("原始主题作用范围")
            .setDesc("笔记模式经过 OsyC 作用域隔离；原生工作区模式保留原主题的全局效果，可能改变 Obsidian 外壳。")
            .addDropdown((dropdown) => dropdown
                .addOptions({ notes: "笔记内容（安全隔离）", workspace: "原生工作区（完整效果）" })
                .setValue(this.appearance.themePackScope)
                .onChange((value) => updateAppearance({ themePackScope: value as AppearanceSettings["themePackScope"] })));
        let bodyFontPreview: HTMLElement | null = null;
        const bodyFontSetting = new Setting(contentEl)
            .setName("正文字体")
            .setDesc("中文无衬线、中文衬线和系统字体使用本地字体栈；设备缺失时自动回退。")
            .addDropdown((dropdown) => dropdown
                .addOptions(fontOptionsWithAvailability({ ...BODY_FONT_OPTIONS, ...Object.fromEntries(this.fontResources.map((resource) => [fontSourceForResource(resource.id), `本地：${resource.family}`])) }, this.fontResources))
                .setValue(this.appearance.fontSource)
                .onChange((value) => {
                    updateAppearance({ fontSource: value as AppearanceSettings["fontSource"] });
                    updateFontPreview(bodyFontPreview, value as FontSource, fontResourceForSource(value, this.fontResources)?.family);
                    if (this.appearance.headingFontSource === "same") updateFontPreview(headingFontPreview, value as FontSource, fontResourceForSource(value, this.fontResources)?.family);
                }));
        bodyFontPreview = appendFontPreview(bodyFontSetting, "正文字体预览", this.appearance.fontSource, fontResourceForSource(this.appearance.fontSource, this.fontResources)?.family);
        let headingFontPreview: HTMLElement | null = null;
        const headingFontSetting = new Setting(contentEl)
            .setName("标题字体")
            .setDesc("可与正文分开选择；默认跟随正文字体。")
            .addDropdown((dropdown) => dropdown
                .addOptions(fontOptionsWithAvailability({ same: "跟随正文字体", ...BODY_FONT_OPTIONS, ...Object.fromEntries(this.fontResources.map((resource) => [fontSourceForResource(resource.id), `本地：${resource.family}`])) }, this.fontResources))
                .setValue(this.appearance.headingFontSource)
                .onChange((value) => {
                    updateAppearance({ headingFontSource: value as AppearanceSettings["headingFontSource"] });
                    const source = (value === "same" ? this.appearance.fontSource : value) as FontSource;
                    updateFontPreview(headingFontPreview, source, fontResourceForSource(source, this.fontResources)?.family);
                }));
        headingFontPreview = appendFontPreview(headingFontSetting, "标题字体预览", this.appearance.headingFontSource === "same" ? this.appearance.fontSource : this.appearance.headingFontSource, fontResourceForSource(this.appearance.headingFontSource === "same" ? this.appearance.fontSource : this.appearance.headingFontSource, this.fontResources)?.family);
        let codeFontPreview: HTMLElement | null = null;
        const codeFontSetting = new Setting(contentEl)
            .setName("代码字体")
            .setDesc("代码块和行内代码独立使用等宽字体，默认跟随系统等宽字体。")
            .addDropdown((dropdown) => dropdown
                .addOptions(fontOptionsWithAvailability({ ...CODE_FONT_OPTIONS, ...Object.fromEntries(this.fontResources.map((resource) => [fontSourceForResource(resource.id), `本地：${resource.family}`])) }, this.fontResources))
                .setValue(this.appearance.codeFontSource)
                .onChange((value) => {
                    updateAppearance({ codeFontSource: value as AppearanceSettings["codeFontSource"] });
                    updateFontPreview(codeFontPreview, value as FontSource, fontResourceForSource(value, this.fontResources)?.family);
                }));
        codeFontPreview = appendFontPreview(codeFontSetting, "代码字体预览", this.appearance.codeFontSource, fontResourceForSource(this.appearance.codeFontSource, this.fontResources)?.family);
        if (this.vaultFonts.length > 0) {
            let selectedFont = this.vaultFonts[0];
            new Setting(contentEl)
                .setName("载入本地字体")
                .setDesc("从 Vault 载入字体文件并保存到 OsyC 私有目录；载入后会立即应用。")
                .addDropdown((dropdown) => dropdown
                    .addOptions(Object.fromEntries(this.vaultFonts.map((path) => [path, path])))
                    .setValue(selectedFont)
                    .onChange((value) => { selectedFont = value; }))
                .addButton((button) => button.setButtonText("载入").onClick(() => {
                    void this.onImportFont(selectedFont).then((resource) => {
                        if (!resource) return;
                        this.fontResources.push(resource);
                        updateAppearance({ fontSource: fontSourceForResource(resource.id) as AppearanceSettings["fontSource"] });
                        new Notice(`字体“${resource.family}”已载入并应用；重新打开设置可在字体列表中选择。`);
                    });
                }));
        }
        new Setting(contentEl)
            .setName("正文字号")
            .setDesc("拖动调整字号")
            .addSlider((slider) => slider.setLimits(13, 24, 1).setValue(this.appearance.fontSize ?? 16).onChange((value) => updateAppearance({ fontSize: value })))
            .addButton((button) => button.setButtonText("跟随主题").onClick(() => updateAppearance({ fontSize: null })));
        new Setting(contentEl)
            .setName("行高")
            .setDesc("拖动调整阅读舒适度")
            .addSlider((slider) => slider.setLimits(1.3, 2.2, 0.1).setValue(this.appearance.lineHeight ?? 1.5).onChange((value) => updateAppearance({ lineHeight: Math.round(value * 10) / 10 })))
            .addButton((button) => button.setButtonText("跟随主题").onClick(() => updateAppearance({ lineHeight: null })));
        const advancedDetails = contentEl.createEl("details", { cls: "osyc-ai-appearance-advanced" });
        advancedDetails.open = typeof window === "undefined" || window.innerWidth > 720;
        advancedDetails.createEl("summary", { text: "详细调整" });
        const advancedContent = advancedDetails.createDiv({ cls: "osyc-ai-appearance-advanced-content" });
        new Setting(advancedContent)
            .setName("内容密度")
            .addDropdown((dropdown) => dropdown
                .addOptions({ minimal: "极简", compact: "紧凑", comfortable: "舒适", spacious: "宽松" })
                .setValue(this.appearance.density)
                .onChange((value) => updateAppearance({ density: value as AppearanceSettings["density"] })));
        new Setting(advancedContent)
            .setName("文字颜色")
            .setDesc("点击色块选择，重置后跟随预设")
            .addColorPicker((picker) => picker.setValue(this.appearance.colourOverrides.text ?? "#ffffff").onChange((value) => {
                updateAppearance({ colourOverrides: { ...this.appearance.colourOverrides, text: value } });
            }))
            .addButton((button) => button.setButtonText("跟随预设").onClick(() => updateAppearance({ colourOverrides: { ...this.appearance.colourOverrides, text: null } })));
        new Setting(advancedContent)
            .setName("强调色")
            .setDesc("点击色块选择，重置后跟随预设")
            .addColorPicker((picker) => picker.setValue(this.appearance.colourOverrides.accent ?? "#5aa9e6").onChange((value) => {
                updateAppearance({ colourOverrides: { ...this.appearance.colourOverrides, accent: value } });
            }))
            .addButton((button) => button.setButtonText("跟随预设").onClick(() => updateAppearance({ colourOverrides: { ...this.appearance.colourOverrides, accent: null } })));
        new Setting(advancedContent)
            .setName("背景模式")
            .addDropdown((dropdown) => dropdown
                .addOptions({ theme: "跟随主题", solid: "纯色", image: "Vault 本地图片" })
                .setValue(this.appearance.background.mode)
                .onChange((value) => updateAppearance({ background: { ...this.appearance.background, mode: value as AppearanceSettings["background"]["mode"] } })));
        if (this.vaultImages.length > 0) {
            new Setting(advancedContent)
                .setName("背景图片")
                .setDesc("仅列出当前 Vault 的图片，不会上传")
                .addDropdown((dropdown) => dropdown
                    .addOption("", "不使用图片")
                    .addOptions(Object.fromEntries(this.vaultImages.map((path) => [path, path])))
                    .setValue(this.appearance.background.vaultPath ?? "")
                    .onChange((value) => updateAppearance({ background: {
                        ...this.appearance.background,
                        mode: value ? "image" : "theme",
                        vaultPath: value || null,
                        opacity: value && this.appearance.background.opacity === 0 ? 0.24 : this.appearance.background.opacity,
                    } })));
        }
        new Setting(advancedContent)
            .setName("背景透明度")
            .setDesc("拖动调整背景可见程度")
            .addSlider((slider) => slider.setLimits(0, 1, 0.05).setValue(this.appearance.background.opacity).onChange((value) => updateAppearance({ background: { ...this.appearance.background, opacity: value } })));
        new Setting(advancedContent)
            .addButton((btn) => btn.setButtonText("恢复外观默认").onClick(() => {
                this.appearance = parseAppearance(DEFAULT_APPEARANCE);
                this.onAppearanceChange(this.appearance);
                refreshPreview();
                this.close();
            }));
        const interactionDetails = contentEl.createEl("details", { cls: "osyc-ai-interaction-advanced" });
        interactionDetails.open = typeof window === "undefined" || window.innerWidth > 720;
        interactionDetails.createEl("summary", { text: "OC 交互" });
        const interactionContent = interactionDetails.createDiv({ cls: "osyc-ai-interaction-content" });
        new Setting(interactionContent)
            .setName("悬浮球常驻显示")
            .setDesc("关闭后不再显示悬浮球，可改用 Obsidian 原生底部栏按钮或三击打开 OC 对话页。")
            .addToggle((tg) => tg.setValue(this.showBall).onChange((v) => this.onShowBallChange(v)));
        new Setting(interactionContent)
            .setName("移动端三击打开 OC")
            .setDesc("手机上连续点三下屏幕任意位置，快速打开 OC 对话页。容易误触可关闭。")
            .addToggle((tg) => tg.setValue(this.tripleTap).onChange((v) => this.onTripleTapChange(v)));
        new Setting(interactionContent)
            .setName("发送时附带当前 Markdown 笔记")
            .setDesc("仅在你点击发送时提交当前 Markdown 正文和编辑位置，不会持续上传。")
            .addToggle((tg) =>
                tg.setValue(this.includeActiveNoteContext).onChange(async (v) => {
                    const applied = await this.onIncludeActiveNoteContextChange(v);
                    if (!applied) tg.setValue(false);
                })
            );
        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText("保存")
                    .setCta()
                    .onClick(() => {
                        this.onSave(this.value);
                        this.close();
                    })
            )
            .addButton((btn) => btn.setButtonText("取消").onClick(() => this.close()));
    }
    override onClose() {
        this.contentEl.empty();
    }
}

/** @deprecated Active-note consent is retained for persisted preference migrations. */
export class ActiveNoteConsentModal extends Modal {
    private approved = false;

    constructor(app: App, private onDecision: (approved: boolean) => void) {
        super(app);
    }

    override onOpen() {
        this.contentEl.empty();
        this.contentEl.createEl("h3", { text: "允许发送当前笔记" });
        this.contentEl.createEl("p", {
            text: "开启后，仅在你点击发送时，OsyC 会将当前 Markdown 正文和编辑位置交给服务处理。不会持续上传，可随时关闭。",
        });
        new Setting(this.contentEl)
            .addButton((button) => button.setButtonText("取消").onClick(() => this.close()))
            .addButton((button) => button.setButtonText("允许").setCta().onClick(() => {
                this.approved = true;
                this.close();
            }));
    }

    override onClose() {
        this.contentEl.empty();
        this.onDecision(this.approved);
    }
}

/**
 * AI 代执行面板的 Obsidian 接线层：视图注册、命令、入口图标、凭据持久化。
 * 业务逻辑全部在 CmdAIAgent 内，这里只负责"接到 Obsidian 上"。
 */
export function useAIAgentUI(host: NecessaryServices<"API" | "appLifecycle", never>, core: LiveSyncCore) {
    const api = host.services.API as unknown as {
        showWindow: (type: string) => Promise<void>;
        registerWindow: (type: string, factory: (leaf: WorkspaceLeaf) => unknown) => void;
        addCommand: (command: {
            id: string;
            name: string;
            callback?: () => void;
            checkCallback?: (checking: boolean) => boolean | void;
        }) => unknown;
        addRibbonIcon: (
            icon: string,
            title: string,
            callback: () => void
        ) => { addClass?: (name: string) => unknown; remove?: () => void } | undefined;
    };
    const app: App = core.services.context.app;
    const adapter = app.vault?.adapter;
    const configPath = `${app.vault.configDir}/${CONFIG_FILE_NAME}`;

    const agent = new CmdAIAgent();
    const announcements = writable<Announcement[]>([]);
    const announcementClient = new AnnouncementClient({ apiBase: "", token: "", request: requestUrl });
    const refreshAnnouncements = async () => {
        announcementClient.configure(agent.settings.apiBase, agent.settings.token);
        announcements.set(await announcementClient.refresh());
    };
    announcements.set(announcementClient.cached());

    agent.artifactWriter = async (artifact: ArtifactMetadata, bytes: Uint8Array) => {
        const path = artifact.path.replace(/\\/g, "/");
        if (!path || path.startsWith("/") || path.split("/").some((part) => !part || part === "." || part === "..")) {
            return { ok: false, message: "结果路径无效" };
        }
        const digest = async (value: Uint8Array): Promise<string> => {
            const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(value).buffer);
            return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
        };
        const existing = app.vault.getAbstractFileByPath(path);
        if (existing instanceof TFile) {
            const current = new TextEncoder().encode(await app.vault.read(existing));
            if (current.byteLength > 0) {
                if (await digest(current) === artifact.sha256) return { ok: true };
                return { ok: false, conflict: true, message: "手机已有同名但内容不同的文件" };
            }
            await app.vault.modify(existing, new TextDecoder().decode(bytes));
            return { ok: true };
        }
        const folders = path.split("/").slice(0, -1);
        let prefix = "";
        for (const folder of folders) {
            prefix = prefix ? `${prefix}/${folder}` : folder;
            if (!app.vault.getAbstractFileByPath(prefix)) {
                try { await app.vault.createFolder(prefix); } catch { /* another sync/device may have created it */ }
            }
        }
        await app.vault.create(path, new TextDecoder().decode(bytes));
        return { ok: true };
    };

    // 「我的账户」弹窗：展示后端下发的档位与权益。按需打开，复用同一个实例。
    const accountModal = new AIAgentAccountModal(app, agent);
    const toolsModal = new AIAgentToolsModal(app, agent, () => accountModal.open());
    const openTools = () => {
        accountModal.close();
        toolsModal.open();
    };

    // 移动端三击打开 Agent 对话页的开关；按设备持久化在 livesync-aiagent.json
    let tripleTapEnabled = true;
    // 悬浮球常驻显示开关；关闭后只走原生底部栏 / 三击
    let showBallEnabled = true;
    // 默认关闭，只有用户在设置中明确授权时才在发送瞬间采集当前 Markdown。
    let includeActiveNoteContext = false;
    let appearance: AppearanceSettings = parseAppearance(undefined);
    let floatingPosition: { x: number; y: number } | undefined;
    let floating: AIAgentFloating;
    let tripleTapTimestamps: number[] = [];
    let themeObserver: MutationObserver | null = null;
    let markdownScopeObserver: MutationObserver | null = null;
    const mountedFontFaces = new Set<FontFace>();
    let removeThemePack: (() => void) | null = null;

    const vaultImages = () => app.vault.getFiles()
        .filter((file) => /\.(?:png|jpe?g|gif|webp|avif)$/i.test(file.path))
        .map((file) => file.path)
        .sort((a, b) => a.localeCompare(b));
    const vaultFonts = () => app.vault.getFiles()
        .filter((file) => /\.(?:woff2?|ttf|otf)$/i.test(file.path))
        .map((file) => file.path)
        .sort((a, b) => a.localeCompare(b));
    void vaultImages;
    void vaultFonts;
    let fontResources: FontResource[] = [];
    const fontResourceUrl = (resource: FontResource): string => {
        const path = fontResourcePath(resource.id, resource.fileName);
        return path && adapter?.getResourcePath ? adapter.getResourcePath(path) : "";
    };
    const mountFontResource = async (resource: FontResource): Promise<boolean> => {
        const descriptor = createFontFaceDescriptor(resource, fontResourceUrl(resource));
        if (!descriptor) return false;
        // FontFace keeps imported resources local without injecting runtime CSS.
        if (typeof document === "undefined" || !("fonts" in document) || typeof FontFace === "undefined") return true;
        try {
            const face = new FontFace(descriptor.family, descriptor.source, descriptor.descriptors);
            await face.load();
            (document.fonts as FontFaceSet & { add(face: FontFace): void }).add(face);
            mountedFontFaces.add(face);
            return true;
        } catch (error) {
            osycLogger.warn("font_resource_mount_failed", { id: resource.id, error: String(error) });
            return false;
        }
    };
    const importFont = async (sourcePath: string): Promise<FontResource | null> => {
        const source = app.vault.getAbstractFileByPath(sourcePath);
        if (!(source instanceof TFile) || !adapter?.readBinary || !adapter.writeBinary) return null;
        const extension = source.name.split(".").pop()?.toLowerCase();
        if (!extension || !/^(?:woff2?|ttf|otf)$/.test(extension)) return null;
        const bytes = await app.vault.readBinary(source);
        if (bytes.byteLength === 0 || bytes.byteLength > 30 * 1024 * 1024) {
            new Notice("字体文件为空或超过 30 MB，未载入");
            return null;
        }
        const base = source.basename.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "font";
        let id = base;
        let suffix = 2;
        while (fontResources.some((resource) => resource.id === id)) id = `${base}-${suffix++}`;
        const resource: FontResource = { id, family: source.basename.slice(0, 80), fileName: `${id}.${extension}`, weight: 400, style: "normal" };
        const destination = fontResourcePath(resource.id, resource.fileName);
        if (!destination) return null;
        let prefix = "";
        for (const segment of FONT_RESOURCE_DIR.split("/")) {
            prefix = prefix ? `${prefix}/${segment}` : segment;
            if (!(await adapter.exists(prefix))) await adapter.mkdir(prefix).catch(() => { /* best effort */ });
        }
        await adapter.writeBinary(destination, bytes);
        if (!(await mountFontResource(resource))) {
            await adapter.remove(destination).catch(() => { /* best effort */ });
            new Notice(`字体“${resource.family}”无法在当前设备载入`);
            return null;
        }
        fontResources = [...fontResources, resource];
        await persist();
        return resource;
    };
    void importFont;

    const refreshAppearanceStyles = () => {
        const file = appearance.background.vaultPath
            ? app.vault.getAbstractFileByPath(appearance.background.vaultPath)
            : null;
        const resourceUrl = file instanceof TFile ? app.vault.getResourcePath(file) : undefined;
        removeThemePack?.();
        removeThemePack = null;
        if (appearance.themePackId) {
            const pack = themePackForId(appearance.themePackId);
            if (pack) {
                removeThemePack = applyThemePackScope(pack, appearance.themePackScope);
            }
        }
        applyThemeProfileStyles(
            migrateAppearanceToThemeProfile(appearance),
            resourceUrl,
            document.body.classList.contains("theme-dark") ? "dark" : "light",
            fontResources
        );
        syncMarkdownThemeScope(app.workspace, appearance.applyToNotes);
    };
    const syncNoteThemeScopes = () => syncMarkdownThemeScope(app.workspace, appearance.applyToNotes);

    const applyAppearance = (next: AppearanceSettings) => {
        appearance = parseAppearance(next);
        refreshAppearanceStyles();
        schedulePersist();
    };

    /**
     * 把后端下发的 setup URI 直接灌进 LiveSync 设置，用户不用自己配同步。
     *
     * 这是选 LiveSync 作基座的战略目的：原本"用户配不出同步"是最大的流失点，
     * 现在只需输入一个卡密，同步自动配好。
     *
     * 写法参照 CLI 的 setup 命令（src/apps/cli/commands/runCommand.ts）。
     *
     * **必须合并，不能整份替换。**
     * 早先的实现以 DEFAULT_SETTINGS 打底再覆盖解码结果，等于把用户自己调过的
     * 偏好（界面语言、其他同步行为……）全部静默重置成默认值。对全新用户无感，
     * 但对已经手动配过插件的老用户是一次难察觉的破坏，而且不可逆。
     * 现在只覆盖后端实际下发的那几个键，其余一律保持用户现状。
     */
    agent.applySetupUri = async (setupUri: string, passphrase: string): Promise<boolean> => {
        try {
            const decoded = await decodeSettingsFromSetupURI(setupUri, passphrase);
            if (!decoded) return false;
            // 合并式写入：applyPartial 而非 applyExternalSettings
            const patch = buildSetupPatch(decoded as unknown as Record<string, unknown>);
            await core.services.setting.applyPartial(patch, true);
            await core.services.control.applySettings();
            return true;
        } catch {
            // 配置失败不该让激活失败 —— 记在返回值里，由 UI 提示手动配置
            return false;
        }
    };

    /**
     * 应用 agent 提出的设置调整建议。
     *
     * 后端只负责「提建议」，真正改配置发生在这里（客户端），而且改之前要**再过一遍
     * 白名单** —— 不信任后端传来的任何键。这样即使后端被攻破、或模型被诱导输出了
     * 危险键，客户端这道校验仍能挡住。
     */
    agent.applySettingsPatch = async (
        patch: Record<string, unknown>
    ): Promise<{ applied: number; rejected: { key: string; reason: string }[] }> => {
        const result = sanitizeLivesyncPatch(patch ?? {});
        const keys = Object.keys(result.applied);
        if (keys.length === 0) {
            return { applied: 0, rejected: result.rejected };
        }
        await core.services.setting.applyPartial(result.applied, true);
        await core.services.control.applySettings();
        return { applied: keys.length, rejected: result.rejected };
    };

    /**
     * 应用 agent 提出的主题片段建议（Pro 权益）。
     *
     * 后端只负责「提建议」（theme_snippet 经任务结果回传，已在后端做 slug 化 + 安全校验），
     * 真正写入 vault 发生在**客户端这里** —— 与设置调整建议同思路：不信任后端直接落盘。
     *
     * 落盘走官方片段存储位置 `<vault>/.obsidian/snippets/<name>.css`，并把 `name`
     * 不修改 `appearance.json`，也不自动启用。用户可以在 Obsidian「外观 → CSS 代码片段」中
     * 查看、启用或关闭它，避免覆盖用户其它外观设置。
     *
     * 命名空间隔离：片段名强制以 `osyc-` 前缀写入，避免与用户已有同名片段冲突或覆盖。
     */
    agent.applyThemeSnippet = async (
        snippet: AISnippet
    ): Promise<{ ok: boolean; message: string }> => {
        if (!adapter) {
            return { ok: false, message: "无法访问 vault 存储" };
        }
        const safeName = snippet.name.startsWith("osyc-") ? snippet.name : `osyc-${snippet.name}`;
        const dir = `${app.vault.configDir}/snippets`;
        const file = `${dir}/${safeName}.css`;
        try {
            // 确保 snippets 目录存在（首次应用主题片段时可能不存在）
            if (!(await adapter.exists(dir))) {
                await adapter.mkdir(dir);
            }
            if (await adapter.exists(file)) {
                // 同名片段已存在：保留用户旧版，不静默覆盖
                return { ok: false, message: `片段 ${safeName} 已存在，请先手动删除再应用` };
            }
            await adapter.write(file, snippet.css);
            return { ok: true, message: `已保存主题片段：${safeName}。请在设置 → 外观 → CSS 代码片段中手动启用` };
        } catch (ex) {
            return { ok: false, message: `应用主题片段失败：${String(ex)}` };
        }
    };

    const persist = async () => {
        if (!adapter) return;
        const data: AIAgentPersisted = {
            version: PERSISTED_VERSION,
            apiBase: agent.settings.apiBase,
            token: agent.settings.token,
            deviceId: agent.deviceId,
            state: get(agent.state),
            tasks: get(agent.tasks),
            tripleTap: tripleTapEnabled,
            showBall: showBallEnabled,
            includeActiveNoteContext,
            floatingPosition,
            appearance,
            fontResources,
        };
        try {
            await adapter.write(configPath, JSON.stringify(data));
        } catch {
            // 写不进去不应影响使用，静默降级
        }
    };

    // 任务轮询时 progress 更新很频繁，落盘做防抖，别每次都写文件
    let saveTimer: number | null = null;
    const schedulePersist = () => {
        if (saveTimer !== null) window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(() => {
            saveTimer = null;
            void persist();
        }, 800);
    };
    agent.tasks.subscribe(schedulePersist);
    agent.state.subscribe(schedulePersist);
    agent.schedules.subscribe(schedulePersist);

    // 仅在 token 发生变化时落盘，避免轮询积分时反复写文件
    let lastToken = "";
    agent.state.subscribe(() => {
        if (agent.settings.token !== lastToken) {
            lastToken = agent.settings.token;
            void persist();
        }
    });

    let openingPane = false;
    const openPane = (): void => {
        if (openingPane) return;
        openingPane = true;
        void api
            .showWindow(VIEW_TYPE_AI_AGENT)
            .catch((error) => {
                // Keep the failure visible on mobile. The next tap is allowed
                // to retry because Obsidian can transiently reject a leaf
                // while it is switching workspaces.
                osycLogger.error("OsyC 页面打开失败", error);
                console.error("OsyC 页面打开失败", error);
                new Notice("OC 页面暂时无法打开，请重试");
            })
            .finally(() => {
                openingPane = false;
            });
    };

    const openFile = (path: string) => {
        void app.workspace.openLinkText(path, "/", false);
    };

    /**
     * 注销当前账户：清空凭据 + 删持久化文件 + 回到未激活状态。
     *
     * 用户场景：换设备超过 3 台上限时自助解绑旧设备、卡密到期后换新卡、
     * 或者单纯想清空本地痕迹。注销不会通知后端解绑（后端记录保留用于客服追溯），
     * 真正解绑走管理端 /admin/devices/revoke。
     */
    const deactivateAccount = async () => {
        agent.deactivate();
        if (adapter) {
            try {
                if (await adapter.exists(configPath)) {
                    await adapter.remove(configPath);
                }
            } catch {
                // 删不掉不影响功能，下次启动重新生成 deviceId
            }
        }
        void persist();
    };

    floating = new AIAgentFloating(app, {
        onOpenPane: openPane,
        onPositionChange: (position) => {
            floatingPosition = position;
            void persist();
        },
    });

    const onWindowError = (event: ErrorEvent) => {
        osycLogger.error("未捕获的 OsyC 窗口错误", event.error ?? event.message);
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
        osycLogger.error("未处理的 OsyC Promise 异常", event.reason);
    };
    window.addEventListener("error", onWindowError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    host.services.appLifecycle.onUnload.addHandler(() => {
        agent.stop();
        if (saveTimer !== null) {
            window.clearTimeout(saveTimer);
            saveTimer = null;
        }
        floating.destroy();
        accountModal.close();
        toolsModal.close();
         themeObserver?.disconnect();
        themeObserver = null;
        markdownScopeObserver?.disconnect();
        markdownScopeObserver = null;
         syncMarkdownThemeScope(app.workspace, false);
         removeThemePack?.();
         removeThemePack = null;
        app.workspace.off("layout-change", syncNoteThemeScopes);
        app.workspace.off("active-leaf-change", syncNoteThemeScopes);
        if (typeof document !== "undefined" && "fonts" in document) {
            const fontSet = document.fonts as FontFaceSet & { delete(face: FontFace): boolean };
            for (const face of mountedFontFaces) fontSet.delete(face);
            mountedFontFaces.clear();
        }
        window.removeEventListener("error", onWindowError);
        window.removeEventListener("unhandledrejection", onUnhandledRejection);
        return Promise.resolve(true);
    });

    api.registerWindow(VIEW_TYPE_AI_AGENT, (leaf: WorkspaceLeaf) => {
        return new AIAgentPaneView(
            leaf,
            agent,
            openFile,
            () => void deactivateAccount(),
            () => openTools(),
            () => void agent.loadCloudVault(),
            (patch: Record<string, unknown>) => agent.applySettingsPatch?.(patch) ?? Promise.resolve({ applied: 0, rejected: [] }),
            (snippet: AISnippet) => agent.applyThemeSnippet?.(snippet) ?? Promise.resolve({ ok: false, message: "当前不可应用主题片段" }),
            () => agent.markOnboarded()
            , async (task) => uploadErrorReport(agent.settings.apiBase, agent.settings.token, task, {
                pluginVersion: typeof MANIFEST_VERSION === "string" ? MANIFEST_VERSION : "dev",
                obsidianVersion: (app as unknown as { appVersion?: string }).appVersion ?? "unknown",
                platform: Platform.isAndroidApp ? "android" : Platform.isIosApp ? "ios" : "desktop",
                runtimeInfo: agent.runtimeInfo,
                diagnosticsLog: osycLogger.report(),
            }, {
                confirm: () => window.confirm("上传脱敏诊断？不会包含 Vault 原文、卡密或 API 密钥。"),
                request: requestUrl,
            }),
            announcements,
            refreshAnnouncements,
            (id: string) => { announcementClient.markRead(id); announcements.set(announcementClient.unread()); }
        );
    });

    api.addRibbonIcon("bot", "OC", () => openPane())?.addClass?.("livesync-ribbon-ai-agent");

    host.services.appLifecycle.onInitialise.addHandler(async () => {
        app.workspace.on("layout-change", syncNoteThemeScopes);
        app.workspace.on("active-leaf-change", syncNoteThemeScopes);
        if (typeof MutationObserver !== "undefined" && app.workspace.containerEl) {
            markdownScopeObserver = new MutationObserver(() => syncNoteThemeScopes());
            markdownScopeObserver.observe(app.workspace.containerEl, { childList: true, subtree: true });
        }
        if (typeof MutationObserver !== "undefined" && document.body) {
            themeObserver = new MutationObserver(() => refreshAppearanceStyles());
            themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });
        }

        api.addCommand({
            id: "open-ai-agent",
            name: "打开 OC 面板",
            callback: () => openPane(),
        });

        // 悬浮球：只作为主工作区 Agent 对话页的入口
        floating.mount();
        api.addCommand({
            id: "open-ai-agent-from-floating",
            name: "打开 OC 对话页",
            callback: () => floating.toggle(),
        });
        api.addCommand({
            id: "open-osyc-log",
            name: "打开日志",
            callback: () => new OsyCLogModal(app).open(),
        });
        api.addCommand({
            id: "copy-osyc-log",
            name: "复制脱敏诊断报告",
            callback: () => {
                void navigator.clipboard
                    .writeText(osycLogger.report())
                    .then(() => new Notice("OsyC 诊断报告已复制"))
                    .catch(() => new Notice("复制失败，请先打开 OsyC 日志窗口重试"));
            },
        });

        // 移动端三击屏幕任意位置 → 打开 Agent 对话页（避开滚动/编辑器，防误触）
        const attachTripleTap = () => {
            const container = app.workspace.containerEl;
            let startX = 0;
            let startY = 0;
            let startT = 0;
            container.addEventListener(
                "touchstart",
                (e: TouchEvent) => {
                    const t = e.touches[0];
                    startX = t.clientX;
                    startY = t.clientY;
                    startT = Date.now();
                },
                { passive: true }
            );
            container.addEventListener(
                "touchend",
                (e: TouchEvent) => {
                    const t = e.changedTouches[0];
                    const dist = Math.hypot(t.clientX - startX, t.clientY - startY);
                    const dur = Date.now() - startT;
                    if (dist > 12 || dur > 300) return; // 滚动/拖动，不算点按
                    const target = e.target as HTMLElement | null;
                    if (!target) return;
                    if (target.closest(".ai-float-ball-root")) return;
                    if (target.closest('input, textarea, [contenteditable="true"], .cm-editor')) return;
                    const now = Date.now();
                    tripleTapTimestamps = tripleTapTimestamps.filter((ts) => now - ts < 600);
                    tripleTapTimestamps.push(now);
                    if (tripleTapTimestamps.length >= 3) {
                        tripleTapTimestamps = [];
                        floating.handleTripleTap();
                    }
                },
                { passive: true }
            );
        };
        attachTripleTap();

        // 读取持久化配置。放在 onInitialise 而非更早，确保 vault 已就绪。
        if (adapter) {
            try {
                if (await adapter.exists(configPath)) {
                    const raw = await adapter.read(configPath);
                    const saved = parseAIAgentPersisted(raw);
                    agent.deviceId = saved.deviceId ?? createDeviceId();
                    if (typeof saved.tripleTap === "boolean") {
                        tripleTapEnabled = saved.tripleTap;
                    }
                    if (typeof saved.showBall === "boolean") {
                        showBallEnabled = saved.showBall;
                    }
                    if (typeof saved.includeActiveNoteContext === "boolean") {
                        includeActiveNoteContext = saved.includeActiveNoteContext;
                    }
                    floatingPosition = saved.floatingPosition;
                    appearance = saved.appearance ?? parseAppearance(undefined);
                    fontResources = saved.fontResources ?? [];
                    await Promise.all(fontResources.map((resource) => mountFontResource(resource)));
                    applyAppearance(appearance);
                    agent.configure(saved.apiBase ?? "", saved.token ?? "");
                    lastToken = agent.settings.token;
                    if (saved.state || saved.tasks) {
                        agent.restore(saved.state, saved.tasks ?? []);
                    }
                    if (agent.settings.token) {
                        await agent.refreshStatus();
                        // 重启后把没跑完的任务重新接上轮询
                        agent.resumePending();
                        await agent.loadSchedules();
                        // 会员/Pro 档：重启后拉取 Cloud-Vault 快照列表（基础档内部直接置为不可用）
                        await agent.loadCloudVault();
                    }
                } else {
                    agent.deviceId = createDeviceId();
                    applyAppearance(appearance);
                    await persist();
                }
            } catch {
                agent.deviceId = createDeviceId();
            }
        } else {
            agent.deviceId = createDeviceId();
            applyAppearance(appearance);
        }

        // 用持久化的三击偏好覆盖默认值
        floating.setTripleTap(tripleTapEnabled);
        floating.setShowBall(showBallEnabled);
        if (floatingPosition) floating.setPosition(floatingPosition);

        return true;
    });

    return agent;
}
