import { Modal, Notice, Platform, Setting, TFile, requestUrl, type App } from "@/deps.ts";
import type { WorkspaceLeaf } from "@/deps";
import { AIAgentPaneView, VIEW_TYPE_AI_AGENT } from "@/osyc/features/AIAgent/AIAgentPaneView";
import { AIAgentFloating } from "@/osyc/features/AIAgent/AIAgentFloating";
import { AIAgentAccountModal } from "@/osyc/features/AIAgent/AIAgentAccountModal";
import { AIAgentToolsModal } from "@/osyc/features/AIAgent/AIAgentToolsModal";
import { CmdAIAgent } from "@/osyc/features/AIAgent/CmdAIAgent";
import type { AISnippet, AITask, ArtifactMetadata } from "@/osyc/features/AIAgent/CmdAIAgent";
import { get, writable } from "svelte/store";
import type { LiveSyncCore } from "@/main";
import type { NecessaryServices } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import { decodeSettingsFromSetupURI } from "@vrtmrz/livesync-commonlib/compat/API/processSetting";
import { buildSetupPatch, planCouchDbRemoteConfigurationReroute, sanitizeLivesyncPatch } from "@/osyc/features/AIAgent/livesyncPatch";
import {
    RemotePreferredTweakStatuses,
    TweakValuesTemplate,
    type ObsidianLiveSyncSettings,
    type RemotePreferredTweakResult,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { extractObject } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import {
    describeReplicationRepair,
    isOfficialManagedRemote,
    planProvisionedReplicationRepair,
    verifyActivatedRemote,
} from "@/osyc/features/AIAgent/livesyncActivation";
import { LiveSyncCouchDBReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/couchdb/LiveSyncReplicator";
import {
    buildLiveSyncDiagnosticSummary,
    buildTweakDiffRows,
    describeLiveSyncError,
    describeRemotePreferredStatus,
    readConfiguredRemote,
    tweakAlignmentAction,
    type LiveSyncControlPort,
    type LiveSyncDiagnosticInput,
    type LiveSyncRepairResult,
    type LiveSyncTweakAlignAction,
    type LiveSyncTweakDiffRow,
} from "@/osyc/features/AIAgent/livesyncSyncActions";
import {
    buildTweakAlignWarning,
    describeTweakAlignment,
    filterAlignmentPatch,
    listTweakDiffKeys,
    planTweakAlignment,
    tweakAlignmentOptionsForRemote,
} from "@/osyc/features/AIAgent/tweakAlignment";
import { resolveServiceUrl } from "@/osyc/features/AIAgent/serviceDefaults";
import { parseAIAgentPersisted, PERSISTED_VERSION, type AIAgentPersisted } from "@/osyc/serviceFeatures/aiAgentPersistence";
import { DEFAULT_APPEARANCE, parseAppearance, type AppearanceSettings } from "@/osyc/features/AIAgent/appearance";
import { applyThemeProfileStyles, migrateAppearanceToThemeProfile } from "@/osyc/theme/themeModel";
import { syncMarkdownThemeScope } from "@/osyc/theme/themeScope";
import { FONT_RESOURCE_DIR, createFontFaceDescriptor, fontResourcePath, type FontResource } from "@/osyc/theme/fontResources";
import { applyThemePackScope, themePackForId } from "@/osyc/theme/themePack";
import { osycLogger } from "@/osyc/serviceFeatures/osycLogger";
import { maskEmailAddress, uploadErrorReport, type AccountDiagnosticSummary } from "@/osyc/features/AIAgent/diagnosticsUpload";
import { AnnouncementClient, type Announcement } from "@/osyc/features/AIAgent/announcements";
import { AnnouncementModal } from "@/osyc/features/AIAgent/AnnouncementModal";
import { setOsycSettingsController } from "@/osyc/features/AIAgent/osycSettingsController";

declare const MANIFEST_VERSION: string | undefined;

/** 存放在 vault 配置目录下，不参与同步，避免把凭据写进笔记库 */
const CONFIG_FILE_NAME = "livesync-aiagent.json";

/**
 * runReplicationRepair 的内部结果。
 *
 * 在 LiveSyncRepairResult 之外附带「远端 PREFERRED 读取状态」与用户确认文案，
 * 供日志、诊断与账号弹窗区分三种结局：真的无差异 / 已静默对齐 / 必须用户确认。
 */
interface ReplicationRepairOutcome {
    changed: boolean;
    changes: string[];
    error?: string;
    requiresUserConfirmation: boolean;
    diffs: LiveSyncTweakDiffRow[];
    recommendedAction: LiveSyncTweakAlignAction | null;
    confirmMessage: string | null;
    remotePreferredStatus: string;
    /** 官方托管远端被自动对齐的 should-match 键；空数组 = 无需对齐或未对齐。 */
    autoAligned: string[];
}

/**
 * 官方托管远端自动对齐的结果。
 *
 * handled = true 表示这已经是最终结论（无需用户确认）：要么已经把差异对齐，
 * 要么两端本来就一致。handled = false 表示调用方还要走提示 / 确认流程。
 */
interface AutoAlignOutcome {
    handled: boolean;
    aligned: string[];
    rebuild: boolean;
    remotePreferred: string;
    changes: string[];
}

/**
 * 「远端 PREFERRED 读取状态 → 结论」：
 * - available：可以逐键比较；
 * - not-configured：云端里程碑还没有 PREFERRED，本机值就是基线（LiveSync 亦以本机值兜底），不可能 diff；
 * - unsupported：当前远端类型没有 tweak 概念；
 * - unavailable：读不到，**不代表无差异**。
 */
function isRemotePreferredComparisonPossible(status: string): boolean {
    return status === RemotePreferredTweakStatuses.AVAILABLE || status === RemotePreferredTweakStatuses.NOT_CONFIGURED;
}

/**
 * 把自愈结果翻成给用户看的中文结论。
 *
 * 硬性约束：**只要存在差异，就绝不告诉用户「配置已是最新、无需修复」**。
 * 因此这里的每个分支都显式区分「真的逐键全等」/「有差异但需确认」/「读不到云端」三种结局。
 */
function describeRepairResult(outcome: ReplicationRepairOutcome): LiveSyncRepairResult {
    const base: LiveSyncRepairResult = {
        ok: !outcome.error,
        changed: outcome.changed,
        changes: outcome.changes,
        message: "",
        requiresUserConfirmation: outcome.requiresUserConfirmation,
        diffs: outcome.diffs,
        recommendedAction: outcome.recommendedAction,
    };
    if (outcome.error) {
        return { ...base, ok: false, message: "同步配置检查失败：" + outcome.error };
    }
    if (outcome.requiresUserConfirmation) {
        return {
            ...base,
            ok: false,
            message:
                (outcome.confirmMessage ?? "检测到同步参数差异，需要你先确认。") +
                " 请点下方的推荐动作完成对齐。",
        };
    }
    if (outcome.remotePreferredStatus !== RemotePreferredTweakStatuses.AVAILABLE) {
        const local = outcome.changed ? "已修复本地同步配置：" + outcome.changes.join("；") + "；" : "";
        if (outcome.remotePreferredStatus === RemotePreferredTweakStatuses.NOT_CONFIGURED) {
            return { ...base, message: local + "云端尚未保存同步参数，本机值将作为基线，无需修复。" };
        }
        if (outcome.remotePreferredStatus === RemotePreferredTweakStatuses.UNSUPPORTED) {
            return { ...base, message: local + "当前远端类型不支持同步参数比对，无需修复。" };
        }
        return {
            ...base,
            ok: false,
            message:
                local +
                "未能读取云端同步参数（" +
                describeRemotePreferredStatus(outcome.remotePreferredStatus) +
                "），无法确认两端参数是否一致。",
        };
    }
    return {
        ...base,
        message: outcome.changed
            ? "已修复同步配置：" + outcome.changes.join("；")
            : "本地与云端的同步参数完全一致，无需修复",
    };
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

    /**
     * 读取远端里程碑里的 PREFERRED tweak 值。
     *
     * 2.0.19 起「修复同步配置」第一次真正看到远端参数。优先用**活动复制器**的
     * getRemotePreferredTweakValues（即 core.replicator.getRemotePreferredTweakValues），
     * 它是 LiveSyncReplicator.js:1203 的实现，返回 { status, values?, error?, reason? }；
     * 活动复制器尚未就绪时退回 LiveSync 官方端口 services.tweakValue.fetchRemotePreferred
     * （由 ModuleResolveMismatchedTweaks._fetchRemotePreferredTweakValues 注册，内部同样调用
     * replicator.getRemotePreferredTweakValues）。两条路径都只读远端，绝不写远端。
     *
     * 注意：这里用 services.replicator.getActiveReplicator()，而不是本文件后面才定义的
     * activeLiveSyncReplicator —— runReplicationRepair 在插件启动时就会被调用，
     * 早于那个 const 的定义，不能依赖它。
     *
     * 15 秒缓存：打开同步面板会先自愈再诊断，避免同一次打开重复拉取远端里程碑。
     */
    let remotePreferredCache: { at: number; value: RemotePreferredTweakResult } | null = null;
    const readRemotePreferredTweakValues = async (
        settings: ObsidianLiveSyncSettings,
        force = false
    ): Promise<RemotePreferredTweakResult> => {
        if (!force && remotePreferredCache && Date.now() - remotePreferredCache.at < 15000) {
            return remotePreferredCache.value;
        }
        const replicator = core.services.replicator.getActiveReplicator();
        let value: RemotePreferredTweakResult;
        if (replicator) {
            try {
                value = await core.services.replicator.runBoundedRemoteActivity(
                    () => replicator.getRemotePreferredTweakValues(settings),
                    { label: "osyc-livesync-remote-tweaks" }
                );
            } catch (error) {
                value = { status: RemotePreferredTweakStatuses.UNAVAILABLE, error };
            }
        } else {
            try {
                value = await core.services.tweakValue.fetchRemotePreferred(settings);
            } catch (error) {
                value = { status: RemotePreferredTweakStatuses.UNAVAILABLE, error };
            }
        }
        remotePreferredCache = { at: Date.now(), value };
        return value;
    };

    /**
     * 官方托管远端的**全自动**对齐（2.0.19 需求变更）。
     *
     * ## 为什么可以自动、而且必须自动
     *
     * - E2EE 只加密**同步分块**；本地 .md 文件仍在磁盘上，`$fetchLocal()` 重建的是
     *   同步库，不会删掉用户笔记；
     * - 本机 `encrypt: true` 对着官方明文远端时，commonlib 的 `ensureRemoteIsCompatible`
     *   永远返回 MISMATCHED，该设备**根本不可能同步成功** —— 对齐是唯一出路；
     * - 官方托管远端由 OsyC 自己签发、固定明文，用户不该为它手动操作。
     *
     * ## 直接复用 LiveSync 自己的「使用远端」分支
     *
     * 与 `src/modules/coreFeatures/ModuleResolveMismatchedTweaks.ts:252-270`
     * `_askResolvingMismatchedTweaks` 的 conf 分支一致，不自己发明对齐逻辑：
     *
     *   1. `Object.assign(settings, extractObject(TweakValuesTemplate, preferred))`
     *   2. `core.services.setting.saveSettingData()`
     *   3. `core.replicator.setPreferredRemoteTweakSettings(settings)`
     *   4. 差异含不兼容键 → `core.rebuilder.$fetchLocal()`
     *
     * ## 安全边界
     *
     * - 只对官方托管远端（`isOsycProvisionedRemote`：官方端点域或 `osyc_sync_` 账号）
     *   自动改；自建 / 非托管远端返回 `handled: false`，由调用方走提示 / 确认流程；
     * - 只写 `TweakValuesTemplate` 里的 tweak 键，并再过一遍 `FORBIDDEN_KEYS`：
     *   `passphrase` / `encryptedPassphrase` / `encryptedCouchDBConnection` / 各类远端
     *   凭据永远只能由激活流程写入，任何自动流程都不得碰。
     */
    const autoAlignOfficialRemoteTweaks = async (source: string): Promise<AutoAlignOutcome> => {
        const outcome: AutoAlignOutcome = {
            handled: false,
            aligned: [],
            rebuild: false,
            remotePreferred: "unknown",
            changes: [],
        };
        try {
            const settings = core.services.setting.currentSettings();
            // 只认硬证据（官方端点域 / osyc_sync_ 账号）：isConfigured 这个弱信号绝不能
            // 作为「自动关掉本机 E2EE」的许可，否则自建远端的用户会被误改。
            if (!isOfficialManagedRemote(settings as unknown as Record<string, unknown>)) {
                // 自建 / 非托管远端：只提示，不自动改。
                return outcome;
            }
            const preferred = await readRemotePreferredTweakValues(settings);
            outcome.remotePreferred = String(preferred.status ?? "unknown");
            if (preferred.status !== RemotePreferredTweakStatuses.AVAILABLE) return outcome;
            // 官方远端必须是明文（我们的 setup URI 从不含 passphrase）。
            if (preferred.values.encrypt !== false) return outcome;

            const plan = planTweakAlignment(
                settings,
                preferred.values,
                tweakAlignmentOptionsForRemote(true)
            );
            if (plan.diffs.length === 0) {
                // 两端本来就一致：这也是终局，无需用户确认。
                outcome.handled = true;
                return outcome;
            }

            const aligned = filterAlignmentPatch(extractObject(TweakValuesTemplate, preferred.values));
            Object.assign(settings, aligned);
            await core.services.setting.saveSettingData();
            await core.services.control.applySettings();
            const replicator = core.services.replicator.getActiveReplicator();
            if (replicator) {
                await core.services.replicator.runBoundedRemoteActivity(
                    () => replicator.setPreferredRemoteTweakSettings(settings),
                    { label: "osyc-livesync-remote-tweaks-register" }
                );
            }
            // 写盘成功之后才算 handled：写设置 / 重建失败时不能假装已对齐。
            outcome.handled = true;
            outcome.aligned = plan.diffs.map((diff) => diff.key);
            outcome.rebuild = plan.incompatible.length > 0;
            outcome.changes = describeTweakAlignment(plan);
            if (outcome.rebuild) await core.rebuilder.$fetchLocal();
            // 一条日志说清：改了什么 / 远端状态 / 是否需要重建。
            osycLogger.info("同步配置自愈", {
                aligned: outcome.aligned,
                remote_preferred: outcome.remotePreferred,
                rebuild: outcome.rebuild,
            });
            return outcome;
        } catch (error) {
            osycLogger.warn(`官方远端自动对齐失败（${source}）`, error);
            // 任一步失败就交回调用方按差异提示处理，绝不假装已经对齐。
            outcome.handled = false;
            outcome.aligned = [];
            return outcome;
        }
    };

    /**
     * 同步配置自愈（2026-09-18 生产故障 + 2026-09-22 移动端反馈 + 2026-10 tweak 差异事故）：
     *
     * - 早期激活流程没有打开 `liveSync` 总开关（setup_uri 载荷不含该键，默认 false），
     *   复制器 `liveSync || syncOnStart` 两个都为 false 时永不启动；
     * - 2.0.13 的激活补丁把 `customChunkSize` 写成 60（must-match 模板基线是 0），
     *   `ensureRemoteIsCompatible` 返回 MISMATCHED，复制器**静默中止** ——
     *   服务端 `_changes` 请求数恒为 0；
     * - `remoteType` 缺失 / 为 null 时复制器同样不会初始化；
     * - 2.0.19 新增：远端 PREFERRED 的**全部 18 个 must-match 键**逐键比较。
     *   - **官方托管远端**：全部差异（含 encrypt）自动对齐，不弹窗、不确认；
     *   - 自建 / 非托管远端：compatible-lossy 静默对齐，
     *     incompatible（尤其 encrypt）**禁止静默改写**，只返回 requiresUserConfirmation。
     *
     * 窄补丁（`liveSync / customChunkSize / remoteType`）走 applyPartial 浅合并，绝不整份替换；
     * 都不需要修时**零写入**。判定由纯函数 planProvisionedReplicationRepair 与
     * planTweakAlignment 负责。
     *
     * 四个调用时机：插件启动、激活成功后、打开插件面板 / 账户弹窗同步面板、以及
     * 每次发起 pull 之前（runOneWayReplication 的开头）。
     * 官方托管远端全程零手动（含 encrypt）；只有自建 / 非托管远端的 incompatible
     * 差异才交给用户确认。
     */
    const runReplicationRepair = async (source: string): Promise<ReplicationRepairOutcome> => {
        const outcome: ReplicationRepairOutcome = {
            changed: false,
            changes: [],
            requiresUserConfirmation: false,
            diffs: [],
            recommendedAction: null,
            confirmMessage: null,
            remotePreferredStatus: "unknown",
            autoAligned: [],
        };
        try {
            const changes: string[] = [];
            // 第一段：历史缺陷的窄补丁自愈。
            const repair = planProvisionedReplicationRepair(core.services.setting.currentSettings());
            if (repair) {
                await core.services.setting.applyPartial(repair, true);
                await core.services.control.applySettings();
                // 日志要含「改了什么值」，供用户上传诊断时与 settings_fingerprint 对照；
                // repair 只含三个非敏感键，不含任何凭据。
                changes.push(...describeReplicationRepair(repair));
                osycLogger.info(`同步配置自愈（${source}）`, { changes: describeReplicationRepair(repair), repair });
            }

            // 第二段之一：官方托管远端 → 全自动对齐（含 encrypt），不弹窗、不确认。
            // 「不要每次都让客户手动解决」：设备一旦 online 就先自愈，用户看不到失败。
            const auto = await autoAlignOfficialRemoteTweaks(source);
            outcome.autoAligned = auto.aligned;
            if (auto.handled) {
                outcome.remotePreferredStatus = auto.remotePreferred;
                if (auto.aligned.length > 0) {
                    changes.push("自动对齐同步参数（" + auto.aligned.join("、") + "）");
                }
                outcome.changed = changes.length > 0;
                outcome.changes = changes;
                return outcome;
            }

            // 第二段之二：自建 / 非托管远端 → 保持「只提示，不自动改」，仍是用户确认后对齐。
            const preferred = await readRemotePreferredTweakValues(core.services.setting.currentSettings());
            outcome.remotePreferredStatus = String(preferred.status ?? "unknown");
            if (!isRemotePreferredComparisonPossible(outcome.remotePreferredStatus)) {
                outcome.changed = changes.length > 0;
                outcome.changes = changes;
                return outcome;
            }
            if (preferred.status === RemotePreferredTweakStatuses.AVAILABLE) {
                const plan = planTweakAlignment(core.services.setting.currentSettings(), preferred.values);
                outcome.diffs = buildTweakDiffRows(plan.diffs);
                if (plan.incompatible.length > 0) {
                    // 禁止静默改写：尤其 encrypt。把完整差异交给 UI，由用户显式确认；
                    // 这里**不写任何设置**，也绝不宣称「已是最新」。
                    outcome.confirmMessage = buildTweakAlignWarning(plan);
                    outcome.recommendedAction = tweakAlignmentAction({
                        tweakDiffRows: outcome.diffs,
                        tweakAlignRequired: true,
                    });
                    outcome.requiresUserConfirmation = true;
                    outcome.changed = changes.length > 0;
                    outcome.changes = changes;
                    osycLogger.warn(`检测到不兼容的同步参数差异（${source}）`, {
                        keys: listTweakDiffKeys(plan),
                        diffs: describeTweakAlignment(plan),
                    });
                    return outcome;
                }
                if (plan.compatibleLossy.length > 0) {
                    // 保持今天的行为：compatible-lossy 静默对齐到远端 PREFERRED 并写回设置。
                    await core.services.setting.applyPartial(plan.silentPatch, true);
                    await core.services.control.applySettings();
                    changes.push("对齐同步参数：" + describeTweakAlignment(plan).join("；"));
                    osycLogger.info(`同步配置自愈（${source}）`, {
                        changes: describeTweakAlignment(plan),
                        keys: listTweakDiffKeys(plan),
                    });
                }
            }
            outcome.changed = changes.length > 0;
            outcome.changes = changes;
            return outcome;
        } catch (error) {
            osycLogger.warn(`同步配置自愈失败（${source}）`, error);
            outcome.error = describeLiveSyncError(error);
            return outcome;
        }
    };

    // 时机一：插件启动。让**已经激活过**、被 2.0.13 写坏的设备不经用户操作就自愈。
    void runReplicationRepair("startup");

    const agent = new CmdAIAgent();
    // 本会话最近一次由 OsyC 发起的 LiveSync 拉取/推送时刻，供诊断摘要使用。
    let lastPullAt: number | null = null;
    let lastPushAt: number | null = null;
    const announcements = writable<Announcement[]>([]);
    const announcementClient = new AnnouncementClient({ apiBase: "", token: "", request: requestUrl });
    // 未读数**只**用于铃铛角标：列表始终是全部公告，标记已读不会让它消失（2026-09-20）。
    const unreadAnnouncements = writable<number>(0);
    const publishAnnouncements = (items: Announcement[]) => {
        announcements.set(items);
        unreadAnnouncements.set(announcementClient.unread(items).length);
    };
    const refreshAnnouncements = async () => {
        announcementClient.configure(agent.settings.apiBase, agent.settings.token);
        publishAnnouncements(await announcementClient.refresh());
    };
    publishAnnouncements(announcementClient.cached());

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
    // 诊断上传端口在 livesyncControl 之后才装配（需要 core.services）：这里先用惰性
    // 转发，装配完成前点击只回一句明确提示，绝不静默失败。
    let uploadDiagnostics: ((task: AITask) => Promise<{ ok: boolean; message: string }>) | null = null;
    const toolsModal = new AIAgentToolsModal(app, agent, () => accountModal.open(), (task) =>
        uploadDiagnostics ? uploadDiagnostics(task) : Promise.resolve({ ok: false, message: "诊断上传尚未就绪，请稍后重试" })
    );
    const announcementsModal = new AnnouncementModal(
        app,
        announcements,
        refreshAnnouncements,
        (id: string) => { announcementClient.markRead(id); publishAnnouncements(announcementClient.cached()); },
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
        osycLogger.info("OsyC setup URI 应用开始");
        try {
            const decoded = await decodeSettingsFromSetupURI(setupUri, passphrase);
            if (!decoded) {
                osycLogger.warn("OsyC setup URI 解码失败");
                return false;
            }
            const decodedValues = decoded as unknown as Record<string, unknown>;
            // 合并式写入：applyPartial 而非 applyExternalSettings
            const patch = buildSetupPatch(decodedValues);

            // 远程配置档案必须一起改写（2026-09-18 现场根因）：
            // LiveSync 2.x 的 SettingService.loadSettings() 在 activeConfigurationId 指向的
            // remoteConfigurations[id] 存在时，会调用 activateRemoteConfiguration(),
            // 用档案 uri 覆盖顶层的 remoteType 与 couchDB_URI/USER/PASSWORD/DBNAME；
            // 而 applyExternalSettings / applyPartial 只做浅合并，**不会**碰
            // remoteConfigurations，adjustSettings() 也只会在档案为空时才从顶层重建。
            // 因此只写顶层字段的设备，下次启动必然被旧档案覆盖回旧端点（实测客户端
            // data.json 里 activeConfigurationId=legacy-couchdb，档案 uri 指向旧的
            // https://sync.sacu3.cn，换了 setup URI 也连不上新后端）。
            // 这里把活动 couchdb 档案的 uri 一并改写成新目标，让顶层字段与档案拓扑一致。
            //
            // 分级原则不变：这不给 agent / 自动流程开口子 —— 身份类键仍只由这条激活链路
            // 写入（buildSetupPatch 不走白名单，planCouchDbRemoteConfigurationReroute
            // 也只接受激活流程的解码结果），而 sanitizeLivesyncPatch 的白名单里没有它们。
            const reroute = planCouchDbRemoteConfigurationReroute(
                decodedValues,
                core.services.setting.currentSettings()
            );
            const mergedPatch: Partial<ObsidianLiveSyncSettings> = reroute.changed
                ? {
                      ...patch,
                      remoteConfigurations: reroute.remoteConfigurations,
                      activeConfigurationId: reroute.activeConfigurationId,
                  }
                : patch;
            await core.services.setting.applyPartial(mergedPatch, true);
            await core.services.control.applySettings();

            // 回读自检（2026-09-20 现场元问题）：此前只保证「applyPartial 没抛异常」，
            // 从不验证「读回来之后能不能用」。新 vault 上 applyPartial 报告成功、
            // UI 也提示「同步已自动配置」，但 data.json 里 activeConfigurationId=""、
            // remoteConfigurations={}，客户端没有任何可用远端，一条笔记都读不到
            // （服务端库里其实有 2954 个 doc）。
            //
            // 判定一律以**活动档案 uri 解析出的值**为准：SettingService 保存时会把
            // 明文顶层 couchDB_* 加密进 encryptedCouchDBConnection 并清空，
            // 用顶层字段判空会把正常保存误判成失败；而 loadSettings() 下次启动
            // 本来就会用档案 uri 覆盖顶层字段。所以档案缺失/非 couchdb 才是真失败。
            const verification = verifyActivatedRemote(core.services.setting.currentSettings());
            if (!verification.ok) {
                console.warn(`激活后未生成可用的同步档案：${verification.reason}`);
                osycLogger.warn("OsyC setup URI 回读自检失败", { reason: verification.reason });
                return false;
            }
            const activatedRemote = readConfiguredRemote(core.services.setting.currentSettings());
            osycLogger.info("OsyC setup URI 应用成功", {
                configurationId: activatedRemote.configurationId,
                configurationName: activatedRemote.configurationName,
                endpoint: activatedRemote.endpoint,
                remoteType: activatedRemote.remoteType,
            });
            // 时机二：激活成功后立刻自愈。即使本次 setup URI 没覆盖到
            // customChunkSize / remoteType（历史设备上的遗留缺陷），也当场纠正。
            await runReplicationRepair("activation");
            return true;
        } catch (error) {
            // 配置失败不该让激活失败 —— 记在返回值里，由 UI 提示手动配置；
            // 但也不能静默吞掉：解码/写入/应用设置任一步抛异常时，日志必须留痕，
            // 否则现场只会看到「激活失败」而没有可排查的线索。
            console.warn("激活写入同步配置时异常，已按配置失败处理");
            osycLogger.warn("OsyC setup URI 应用异常", error);
            return false;
        }
    };

    /**
     * LiveSync 同步诊断与动作端口（接线层实现）。
     *
     * 账户弹窗「同步」区只调用这里；所有能力都走 core.services 的
     * replicator / replication / setting / rebuilder，不写死任何 HTTP。
     *
     * 关键的「接受远端里程碑」调的是 LiveSync 自己的
     * LiveSyncAbstractReplicator.markRemoteResolved()：它把本机 nodeid
     * 并入远端里程碑的 accepted_nodes，等价于原生设置里的
     * 「Unlock / Accept this device」。现场事故就是缺这一步：
     * 里程碑没有本机，客户端永远停在握手阶段，一个文件都下不来。
     */
    const currentLiveSyncSettings = () => core.services.setting.currentSettings();
    const activeLiveSyncReplicator = () => core.services.replicator.getActiveReplicator();

    const ensureLiveSyncNodeId = async (
        replicator: NonNullable<ReturnType<typeof activeLiveSyncReplicator>>
    ): Promise<string> => {
        if (!replicator.nodeid) {
            await replicator.initializeDatabaseForReplication();
        }
        if (!replicator.nodeid) {
            throw new Error("本机设备 ID 尚未生成，请重启 Obsidian 后再试");
        }
        return replicator.nodeid;
    };

    const readRemoteMilestone = async (
        replicator: NonNullable<ReturnType<typeof activeLiveSyncReplicator>>
    ) => {
        const settings = currentLiveSyncSettings();
        return await core.services.replicator.runBoundedRemoteActivity(
            () => replicator.getConnectedDeviceList(settings),
            { label: "osyc-livesync-milestone" }
        );
    };

    const runOneWayReplication = async (mode: "pullOnly" | "pushOnly"): Promise<void> => {
        // 「每次发起 pull 之前」都要自愈：设备一 online 就先对齐官方远端参数，
        // 用户就看不到那句「拉取失败」和 mismatch 提示。对齐失败不影响本次拉取尝试。
        if (mode === "pullOnly") {
            await autoAlignOfficialRemoteTweaks("before-pull");
        }
        const settings = currentLiveSyncSettings();
        const replicator = activeLiveSyncReplicator();
        const label = mode === "pullOnly" ? "osyc-livesync-fetch" : "osyc-livesync-push";
        if (!replicator) throw new Error("LiveSync 复制器未就绪，请稍后重试或重启 Obsidian");
        if (!(replicator instanceof LiveSyncCouchDBReplicator)) {
            throw new Error("当前远端类型不支持单向同步，请在同步设置中使用 CouchDB 远端");
        }
        osycLogger.info(mode === "pullOnly" ? "OsyC LiveSync 拉取开始" : "OsyC LiveSync 推送开始", { label });
        try {
            await core.services.replicator.runFiniteReplicationActivity(
                async () => {
                    const ok = await replicator.openOneShotReplication(settings, true, false, mode, true);
                    if (!ok) {
                        throw new Error(
                            mode === "pullOnly"
                                ? "拉取未完成：远端连接失败或同步已取消"
                                : "推送未完成：远端连接失败或同步已取消"
                        );
                    }
                },
                { label }
            );
        } catch (error) {
            osycLogger.warn("OsyC LiveSync 同步失败", { mode, reason: describeLiveSyncError(error) });
            throw error;
        }
        if (mode === "pullOnly") lastPullAt = Date.now();
        else lastPushAt = Date.now();
        osycLogger.info(mode === "pullOnly" ? "OsyC LiveSync 拉取完成" : "OsyC LiveSync 推送完成", { label });
    };

    agent.livesyncControl = {
        async diagnose(): Promise<LiveSyncDiagnosticInput> {
            const settings = currentLiveSyncSettings();
            const input: LiveSyncDiagnosticInput = {
                ...readConfiguredRemote(settings),
                localNodeId: null,
                acceptedNodes: null,
                protocolVersion: null,
                error: null,
            };
            const replicator = activeLiveSyncReplicator();
            if (!replicator) {
                input.error = "LiveSync 复制器未就绪，无法读取远端里程碑";
                return input;
            }
            const errors: string[] = [];
            try {
                input.localNodeId = await ensureLiveSyncNodeId(replicator);
            } catch (error) {
                errors.push(describeLiveSyncError(error));
            }
            try {
                const list = await readRemoteMilestone(replicator);
                if (list === false) {
                    errors.push("未能读取远端里程碑（远端未初始化或网络不可达）");
                } else {
                    input.acceptedNodes = list.accepted_nodes ?? [];
                }
            } catch (error) {
                errors.push("读取远端里程碑失败：" + describeLiveSyncError(error));
            }
            if (replicator instanceof LiveSyncCouchDBReplicator) {
                try {
                    const params = await core.services.replicator.runBoundedRemoteActivity(
                        () => replicator.getSyncParameters(settings),
                        { label: "osyc-livesync-sync-parameters" }
                    );
                    input.protocolVersion = params ? params.protocolVersion ?? null : null;
                } catch (error) {
                    errors.push("读取 sync_parameters 失败：" + describeLiveSyncError(error));
                }
            }
            // 2.0.19：tweak 握手阶段的三项证据。诊断必须能自证「为什么复制没开始」——
            // 此前 livesync_summary.error 为 null，用户上传的诊断看不出任何原因。
            const preferred = await readRemotePreferredTweakValues(settings);
            input.remotePreferredStatus = String(preferred.status ?? "unknown");
            input.tweakSettingsMismatched = replicator.tweakSettingsMismatched === true;
            if (preferred.status === RemotePreferredTweakStatuses.AVAILABLE && preferred.values) {
                input.tweakDiff = planTweakAlignment(settings, preferred.values).diffs;
            } else if (replicator.preferredTweakValue) {
                // 远端 PREFERRED 读不到时，用复制器失败时已就位的缓存值兜底。
                input.tweakDiff = planTweakAlignment(settings, replicator.preferredTweakValue).diffs;
            }
            if (errors.length > 0) input.error = errors.join("；");
            return input;
        },

        // 时机三：每次打开账户弹窗 / 同步面板都会调一次。幂等，不需要修时零写入。
        // 只有真的对齐过参数时才补一次拉取 —— 如果自愈把设备修好了，同步应当立刻开始，
        // 而不是等用户再点一次「从远端拉取」。
        async reconcileSyncConfiguration() {
            const outcome = await runReplicationRepair("panel");
            const result = describeRepairResult(outcome);
            if (outcome.autoAligned.length === 0) return result;
            try {
                await runOneWayReplication("pullOnly");
                return { ...result, message: result.message + "；已触发一次拉取" };
            } catch (error) {
                return {
                    ...result,
                    message: result.message + "；拉取失败：" + describeLiveSyncError(error),
                };
            }
        },

        // 「修复同步配置」按钮：一键自愈 + 完成后立刻拉取一次。
        // 只要存在 incompatible 差异就**不拉取**：复制必定被中止，必须先要用户显式确认。
        async repairSyncConfiguration() {
            const outcome = await runReplicationRepair("manual");
            const result = describeRepairResult(outcome);
            if (result.requiresUserConfirmation) return result;
            try {
                await runOneWayReplication("pullOnly");
                return { ...result, message: result.message + "；已触发一次拉取" };
            } catch (error) {
                return {
                    ...result,
                    ok: false,
                    message: result.message + "；拉取失败：" + describeLiveSyncError(error),
                };
            }
        },

        // 用户在差异列表上显式确认后的对齐：把云端 PREFERRED 的全部分歧键写回本机，
        // 再走 LiveSync **自己的**重建路径 core.rebuilder.$fetchLocal()（与
        // ModuleResolveMismatchedTweaks._askResolvingMismatchedTweaks 在「采用远端 +
        // 需要重建」时的做法一致）。不自己实现任何重建逻辑。
        async alignTweaksToRemote() {
            const settings = core.services.setting.currentSettings();
            const preferred = await readRemotePreferredTweakValues(settings, true);
            if (preferred.status !== RemotePreferredTweakStatuses.AVAILABLE || !preferred.values) {
                return {
                    ok: false,
                    changed: false,
                    changes: [],
                    message:
                        "无法读取云端同步参数（" +
                        describeRemotePreferredStatus(preferred.status) +
                        "），未做任何改动。",
                };
            }
            const plan = planTweakAlignment(settings, preferred.values);
            if (plan.diffs.length === 0) {
                return { ok: true, changed: false, changes: [], message: "本地与云端的同步参数完全一致，无需对齐。" };
            }
            const changes = describeTweakAlignment(plan);
            try {
                // 与 _askResolvingMismatchedTweaks 的 conf 分支一致：先用
                // extractObject(TweakValuesTemplate, preferred) 覆盖 tweak 键，再就地落盘
                // （复制器与同步面板可能正持有 settings 这个引用），然后登记远端 preferred，
                // 需要重建时走 LiveSync 自己的 $fetchLocal()。
                const aligned = filterAlignmentPatch(extractObject(TweakValuesTemplate, preferred.values));
                Object.assign(settings, aligned);
                await core.services.setting.saveSettingData();
                await core.services.control.applySettings();
                const replicator = activeLiveSyncReplicator();
                if (replicator) {
                    await core.services.replicator.runBoundedRemoteActivity(
                        () => replicator.setPreferredRemoteTweakSettings(settings),
                        { label: "osyc-livesync-remote-tweaks-register" }
                    );
                }
                if (plan.incompatible.length > 0) await core.rebuilder.$fetchLocal();
            } catch (error) {
                osycLogger.warn("与云端对齐同步参数失败", error);
                return {
                    ok: false,
                    changed: false,
                    changes,
                    message: "与云端对齐失败：" + describeLiveSyncError(error),
                };
            }
            osycLogger.info("已与云端对齐同步参数", { keys: listTweakDiffKeys(plan), changes });
            return {
                ok: true,
                changed: true,
                changes,
                message:
                    "已与云端对齐同步参数（" +
                    listTweakDiffKeys(plan).join("、") +
                    "），并已按云端参数重建本地同步库。",
            };
        },

        async acceptRemoteMilestone(): Promise<void> {
            const settings = currentLiveSyncSettings();
            const replicator = activeLiveSyncReplicator();
            if (!replicator) throw new Error("LiveSync 复制器未就绪，请稍后重试或重启 Obsidian");
            await ensureLiveSyncNodeId(replicator);
            await core.services.replicator.runBoundedRemoteActivity(
                () => replicator.markRemoteResolved(settings),
                { label: "osyc-livesync-accept-milestone" }
            );
            const list = await readRemoteMilestone(replicator);
            if (list === false) {
                throw new Error("已提交加入远端，但回读里程碑失败，无法确认结果；请稍后重新诊断");
            }
            if (!(list.accepted_nodes ?? []).includes(replicator.nodeid)) {
                throw new Error("已提交加入远端，但远端里程碑仍未包含本机；请确认远端未被锁定、网络可用后重试");
            }
            // 接受成功后立刻拉取一次，让本机马上开始下载。
            if (replicator instanceof LiveSyncCouchDBReplicator) {
                await runOneWayReplication("pullOnly");
            } else {
                await core.services.replication.replicate(true);
            }
            osycLogger.info("OsyC 已加入远端里程碑");
        },

        fetchFromRemote: () => runOneWayReplication("pullOnly"),
        pushToRemote: () => runOneWayReplication("pushOnly"),
        rebuildLocalFromRemote: () => core.rebuilder.$performRebuildDB("localOnly"),
        overwriteRemoteWithLocal: () => core.rebuilder.$performRebuildDB("remoteOnly"),
    } satisfies LiveSyncControlPort;

    /**
     * 采集一份脱敏诊断上下文：账户档位与登录态、LiveSync 摘要（含关键设置指纹）、
     * 最近 API 失败摘要、以及完整日志缓冲。
     *
     * 这里只负责取值，不取任何凭据（卡密 / token / 口令 / 完整 setup URI）；
     * 每个字段在 buildErrorReportPayload 里还会再过一遍脱敏。
     */
    const collectDiagnosticContext = async () => {
        const state = get(agent.state);
        const email = agent.emailAccount;
        const account: AccountDiagnosticSummary = {
            plan: state.plan,
            activated: state.activated,
            login: email ? "email" : state.activated || agent.settings.token ? "card" : "none",
            email_masked: email ? maskEmailAddress(email.masked) : null,
        };
        const settings = currentLiveSyncSettings();
        const remote = readConfiguredRemote(settings);
        let input: LiveSyncDiagnosticInput = {
            ...remote,
            localNodeId: null,
            acceptedNodes: null,
            protocolVersion: null,
            lastPullAt,
            lastPushAt,
            error: null,
        };
        try {
            const control = agent.livesyncControl;
            if (control) input = { ...(await control.diagnose()), lastPullAt, lastPushAt };
        } catch (error) {
            input = { ...input, error: describeLiveSyncError(error) };
        }
        return {
            pluginVersion: typeof MANIFEST_VERSION === "string" ? MANIFEST_VERSION : "dev",
            obsidianVersion: (app as unknown as { appVersion?: string }).appVersion ?? "unknown",
            platform: Platform.isAndroidApp ? "android" : Platform.isIosApp ? "ios" : "desktop",
            runtimeInfo: agent.runtimeInfo,
            diagnosticsLog: osycLogger.report(),
            accountSummary: account,
            livesyncSummary: buildLiveSyncDiagnosticSummary(
                {
                    ...input,
                    lastPullAt: input.lastPullAt ?? state.syncState.last_pull_at,
                    lastPushAt: input.lastPushAt ?? state.syncState.last_push_at,
                },
                settings
            ),
            apiFailures: osycLogger.apiFailures(),
        };
    };

    uploadDiagnostics = async (task: AITask) => {
        const context = await collectDiagnosticContext();
        return uploadErrorReport(agent.settings.apiBase, agent.settings.token, task, context, {
            confirm: () => window.confirm("上传脱敏诊断？不会包含 Vault 原文、卡密或 API 密钥。"),
            request: requestUrl,
        });
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
        const view = new AIAgentPaneView(
            leaf,
            agent,
            openFile,
            () => void deactivateAccount(),
            () => openTools(),
            () => void agent.loadCloudVault(),
            (patch: Record<string, unknown>) => agent.applySettingsPatch?.(patch) ?? Promise.resolve({ applied: 0, rejected: [] }),
            (snippet: AISnippet) => agent.applyThemeSnippet?.(snippet) ?? Promise.resolve({ ok: false, message: "当前不可应用主题片段" }),
            () => agent.markOnboarded(),
            async (task) => uploadDiagnostics
                ? uploadDiagnostics(task)
                : { ok: false, message: "诊断上传尚未就绪，请稍后重试" },
            unreadAnnouncements,
            openAnnouncements,
            openAccount,
        );
        // 「打开插件面板时」自愈：与账户弹窗同步面板共用同一份 reconcile ——
        // 若真的对齐了参数，reconcile 会顺手补一次拉取，用户不必再点一次。
        view.onPaneOpened = () => {
            void agent.livesyncControl?.reconcileSyncConfiguration();
        };
        return view;
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

        // B2（2.0.16 上架阻断）：全新安装时还没有 livesync-aiagent.json，下面的
        // 加载分支不会命中，settings.apiBase 会一直保持空串 —— activate() 开头的
        // hasApiBase 检查随即返回「尚未配置服务地址」，买家第一次点激活连请求都
        // 发不出去。这里先把官方默认地址兜底落下（空值 → https://api4.sacu3.cn），
        // 有配置文件时再由下面的加载分支用真实值覆盖。
        agent.configure(resolveServiceUrl(undefined), "");

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
                    // 空值 / 历史官方地址统一解析成官方默认入口（见 serviceDefaults.ts）：
                    // 新用户装完插件不填地址也能激活，老用户从 CF 慢链路迁到直连入口。
                    agent.configure(resolveServiceUrl(saved.apiBase), saved.token ?? "");
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
