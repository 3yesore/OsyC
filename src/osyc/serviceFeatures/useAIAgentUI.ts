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
import { DEFAULT_APPEARANCE, parseAppearance, type AppearanceSettings } from "@/osyc/features/AIAgent/appearance";
import { applyThemeProfileStyles, migrateAppearanceToThemeProfile } from "@/osyc/theme/themeModel";
import { syncMarkdownThemeScope } from "@/osyc/theme/themeScope";
import { FONT_RESOURCE_DIR, createFontFaceDescriptor, fontResourcePath, type FontResource } from "@/osyc/theme/fontResources";
import { applyThemePackScope, themePackForId } from "@/osyc/theme/themePack";
import { osycLogger } from "@/osyc/serviceFeatures/osycLogger";
import { uploadErrorReport } from "@/osyc/features/AIAgent/diagnosticsUpload";
import { AnnouncementClient, type Announcement } from "@/osyc/features/AIAgent/announcements";
import { AnnouncementModal } from "@/osyc/features/AIAgent/AnnouncementModal";
import { setOsycSettingsController } from "@/osyc/features/AIAgent/osycSettingsController";

declare const MANIFEST_VERSION: string | undefined;

/** 存放在 vault 配置目录下，不参与同步，避免把凭据写进笔记库 */
const CONFIG_FILE_NAME = "livesync-aiagent.json";

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
    const announcementsModal = new AnnouncementModal(
        app,
        announcements,
        refreshAnnouncements,
        (id: string) => { announcementClient.markRead(id); announcements.set(announcementClient.unread()); },
    );
    const openAnnouncements = () => {
        toolsModal.close();
        accountModal.close();
        announcementsModal.open();
    };
    const openTools = () => {
        accountModal.close();
        toolsModal.open();
    };
    // 「我的账户」直连入口：权益与设备都在这里看，操作仍走工具中心。
    const openAccount = () => {
        toolsModal.close();
        announcementsModal.close();
        accountModal.open();
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

    /**
     * 把运行时偏好接到原生设置页。
     *
     * 设置页只渲染官方 Setting 组件，读写全部回到这里，因此不会出现第二份状态。
     * 注册发生在服务装配期，设置页在任意时刻打开都能取到最新值。
     */
    setOsycSettingsController({
        snapshot: () => ({
            serviceUrl: agent.settings.apiBase,
            tripleTap: tripleTapEnabled,
            showBall: showBallEnabled,
            includeActiveNoteContext,
            appearance,
            fontResources,
        }),
        vaultImages,
        vaultFonts,
        setServiceUrl: (value) => {
            agent.configure(value, agent.settings.token);
            void persist();
        },
        setTripleTap: (value) => {
            tripleTapEnabled = value;
            floating.setTripleTap(value);
            void persist();
        },
        setShowBall: (value) => {
            showBallEnabled = value;
            floating.setShowBall(value);
            void persist();
        },
        setIncludeActiveNoteContext: async (value) => {
            includeActiveNoteContext = value;
            await persist();
            return true;
        },
        setAppearance: (next) => applyAppearance(next),
        resetAppearance: () => applyAppearance(parseAppearance(DEFAULT_APPEARANCE)),
        importFont,
        resolveResourceUrl: (vaultPath) => {
            const file = app.vault.getAbstractFileByPath(vaultPath);
            return file instanceof TFile ? app.vault.getResourcePath(file) : "";
        },
        openLog: () => new OsyCLogModal(app).open(),
        copyDiagnostics: async () => {
            try {
                await navigator.clipboard.writeText(osycLogger.report());
                new Notice("OsyC 诊断报告已复制");
            } catch {
                new Notice("复制失败，请先打开 OsyC 日志窗口重试");
            }
        },
        pluginVersion: () => (typeof MANIFEST_VERSION === "string" ? MANIFEST_VERSION : "dev"),
    });

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
        // 设置页可能仍开着，先摘掉桥，避免它继续读到已销毁的运行时。
        setOsycSettingsController(null);
        if (saveTimer !== null) {
            window.clearTimeout(saveTimer);
            saveTimer = null;
        }
        floating.destroy();
        accountModal.close();
        toolsModal.close();
        announcementsModal.close();
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
            () => agent.markOnboarded(),
            async (task) => uploadErrorReport(agent.settings.apiBase, agent.settings.token, task, {
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
            openAnnouncements,
            openAccount,
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
