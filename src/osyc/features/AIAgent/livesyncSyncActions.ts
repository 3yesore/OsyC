/**
 * OsyC「同步」区的 LiveSync 动作清单与诊断摘要。
 *
 * ## 为什么要有这一层
 *
 * 现场事故（2026-09 新设备激活）：同步不报错，但**一个文件都下不来**。
 * 服务器日志显示客户端只做了 milestone GET/PUT、sync_parameters GET 与 version GET，
 * 从未发起 _changes —— 即卡在「里程碑/配置握手」阶段等待用户确认，而用户
 * 不知道要去 LiveSync 原生设置里点「Unlock / 接受本机」。
 *
 * 因此把 LiveSync 的常见动作收进 OsyC 账户弹窗的同步区，并把
 * 「远端里程碑是否已接受本机」这一条显式呈现出来。
 *
 * ## 分层
 *
 * 本文件是**纯逻辑**：不 import obsidian、不碰 core.services，全部输入输出都是普通对象，
 * 因此可以在 Node 下直接单测。真正的 LiveSync 调用在 useAIAgentUI.ts 的接线层
 * （那里才拿得到 core.services），UI 在 AIAgentAccountModal.ts。
 *
 * 危险动作（重建本机 / 覆盖远端）一律要求显式确认：runLiveSyncAction 先 await
 * confirm 回调，未确认就不调用任何端口方法。
 */

import {
    buildTweakDiffRecord,
    classifyTweakKey,
    describeTweakValue,
    tweakKeyLabel,
    type TweakAlignmentDiff,
    type TweakAlignmentKind,
} from "./tweakAlignment";

/** 同步区列表里的一行 tweak 差异（已翻成中文标签与可读值）。 */
export interface LiveSyncTweakDiffRow {
    key: string;
    label: string;
    local: string;
    preferred: string;
    kind: TweakAlignmentKind;
}

/**
 * 「与云端对齐同步参数」这一唯一推荐动作。
 *
 * 只有在存在 incompatible 差异（尤其是 encrypt）时才会出现：此时禁止静默改写，
 * 必须由用户显式确认，确认后按 LiveSync 自己的 core.rebuilder.$fetchLocal() 对齐。
 */
export interface LiveSyncTweakAlignAction {
    id: "align-tweaks";
    label: string;
    icon: string;
    description: string;
    risk: "danger";
    confirmMessage: string;
    runningLabel: string;
    successMessage: string;
}

/** 五个 LiveSync 动作的稳定 id。 */
export type LiveSyncActionId =
    | "accept-milestone"
    | "fetch-remote"
    | "push-local"
    | "rebuild-local"
    | "overwrite-remote";

/** safe = 单向增量操作；danger = 需要二次确认；critical = 二次确认 + 输入确认词。 */
export type LiveSyncRisk = "safe" | "danger" | "critical";

export interface LiveSyncActionDescriptor {
    id: LiveSyncActionId;
    label: string;
    icon: string;
    description: string;
    risk: LiveSyncRisk;
    /** 执行中按钮文案（要求：执行中禁用并显示进行中）。 */
    runningLabel: string;
    /** 成功后的中文提示。 */
    successMessage: string;
    /** danger / critical 的确认正文；safe 不设。 */
    confirmMessage?: string;
    /** critical 需要逐字输入的确认词。 */
    confirmKeyword?: string;
}

/**
 * 动作定义。顺序即 UI 顺序：由安全到危险；最危险的「覆盖远端」固定最后。
 * 注意：这里只是元数据，任何动作都不会自动执行。
 */
export const LIVESYNC_ACTIONS: readonly LiveSyncActionDescriptor[] = [
    {
        id: "accept-milestone",
        label: "接受远端里程碑 / 加入远端",
        icon: "shield-check",
        description:
            "把本机设备 ID 写入远端里程碑的 accepted_nodes，然后立即拉取一次。仅在诊断显示「远端里程碑尚未接受本机」时才会出现。",
        risk: "safe",
        runningLabel: "正在加入远端…",
        successMessage: "已加入远端里程碑，并已触发一次拉取。",
    },
    {
        id: "fetch-remote",
        label: "从远端拉取",
        icon: "download",
        description: "只把远端变更拉到本机，单向远程 → 本机，不会上传本机内容。",
        risk: "safe",
        runningLabel: "正在拉取…",
        successMessage: "拉取完成。",
    },
    {
        id: "push-local",
        label: "推送本机变更",
        icon: "upload",
        description: "只把本机变更推到远端，单向本机 → 远程，不会下载远端内容。",
        risk: "safe",
        runningLabel: "正在推送…",
        successMessage: "推送完成。",
    },
    {
        id: "rebuild-local",
        label: "重建本机（用远端覆盖本机）",
        icon: "hard-drive-download",
        description: "危险：丢弃本机同步数据库并从远端完整重建。",
        risk: "danger",
        runningLabel: "正在用远端重建本机…",
        successMessage: "已用远端重建本机同步数据库。",
        confirmMessage: "本机文件会被远端版本覆盖，未同步的本机改动可能丢失。确定继续吗？",
    },
    {
        id: "overwrite-remote",
        label: "覆盖远端（用本机覆盖远端）",
        icon: "hard-drive-upload",
        description: "最危险：清空远端数据库并用本机内容重写，会影响所有其它设备。",
        risk: "critical",
        runningLabel: "正在用本机覆盖远端…",
        successMessage: "已用本机覆盖远端数据库。",
        confirmMessage: "远端会被本机内容整体覆盖：远端独有的历史与其它设备未上传的改动都会丢失，且不可逆。",
        confirmKeyword: "覆盖远端",
    },
];

const ACTION_METHOD: Record<LiveSyncActionId, keyof LiveSyncActionPort> = {
    "accept-milestone": "acceptRemoteMilestone",
    "fetch-remote": "fetchFromRemote",
    "push-local": "pushToRemote",
    "rebuild-local": "rebuildLocalFromRemote",
    "overwrite-remote": "overwriteRemoteWithLocal",
};

/** 接线层真正调用 LiveSync 的能力；每一项都是单向/明确的动作。 */
export interface LiveSyncActionPort {
    /** 把本机 node id 加入远端里程碑 accepted_nodes，并在成功后触发一次拉取。 */
    acceptRemoteMilestone(): Promise<void>;
    /** 单向远程 → 本机。 */
    fetchFromRemote(): Promise<void>;
    /** 单向本机 → 远程。 */
    pushToRemote(): Promise<void>;
    /** 用远端覆盖本机（rebuilder localOnly）。 */
    rebuildLocalFromRemote(): Promise<void>;
    /** 用本机覆盖远端（rebuilder remoteOnly）。 */
    overwriteRemoteWithLocal(): Promise<void>;
}

/**
 * 「修复同步配置」的结果。
 *
 * `ok` = 链路可用（修复动作 + 完成后的一次拉取都没被拒），
 * `changed` = 本次是否真的写了设置（幂等：不需要修时为 false 且零写入）。
 */
export interface LiveSyncRepairResult {
    ok: boolean;
    changed: boolean;
    changes: string[];
    message: string;
    /** 存在 incompatible 差异、必须用户显式确认后才能对齐（此时 changed 一定为 false）。 */
    requiresUserConfirmation?: boolean;
    /** 需要确认时列出的完整差异（本机值 vs 云端值）。 */
    diffs?: LiveSyncTweakDiffRow[];
    /** 唯一的推荐动作；无需确认时为 null / 省略。 */
    recommendedAction?: LiveSyncTweakAlignAction | null;
}

/** 接线层额外提供的只读诊断与同步配置自愈。 */
export interface LiveSyncControlPort extends LiveSyncActionPort {
    diagnose(): Promise<LiveSyncDiagnosticInput>;
    /**
     * 幂等同步配置自愈：只在需要时写 `liveSync / customChunkSize / remoteType` 窄补丁，
     * 只走 applyPartial（浅合并），绝不整份替换；不需要修时零写入，也不触发同步动作。
     * 账户弹窗每次打开同步面板都会调一次（见 AIAgentAccountModal.paintLiveSyncPanel）。
     */
    reconcileSyncConfiguration(): Promise<LiveSyncRepairResult>;
    /** 一键修复：先 reconcile，完成后立刻拉取一次；账户弹窗与工具中心两个按钮复用同一实现。 */
    repairSyncConfiguration(): Promise<LiveSyncRepairResult>;
    /**
     * 与云端对齐全部 tweak 键：**仅**由用户在差异列表上显式确认后调用。
     *
     * 只对 compatible-lossy 键静默对齐；存在 incompatible 键时先写回云端 PREFERRED，
     * 再走 LiveSync 自己的重建路径（core.rebuilder.$fetchLocal()，与
     * ModuleResolveMismatchedTweaks._askResolvingMismatchedTweaks 的做法一致）。
     */
    alignTweaksToRemote(): Promise<LiveSyncRepairResult>;
}

/** 诊断原始输入：全部来自 LiveSync（core.services）与后端同步快照。 */
export interface LiveSyncDiagnosticInput {
    configurationId?: string | null;
    configurationName?: string | null;
    /** 已脱敏（仅域名）的远端端点。 */
    endpoint?: string | null;
    remoteType?: string | null;
    protocolVersion?: string | number | null;
    localNodeId?: string | null;
    acceptedNodes?: readonly string[] | null;
    lastPullAt?: number | null;
    lastPushAt?: number | null;
    error?: string | null;
    /** 远端 PREFERRED 的读取状态（available / unavailable / not-configured / unsupported）。 */
    remotePreferredStatus?: string | null;
    /** 本机 vs 云端 PREFERRED 的 must-match 差异；空数组 = 真的没有差异。 */
    tweakDiff?: readonly TweakAlignmentDiff[] | null;
    /** 复制器最近一次握手是否被判 MISMATCHED（core.replicator.tweakSettingsMismatched）。 */
    tweakSettingsMismatched?: boolean | null;
}

/** 诊断展示模型：renderSyncState 只读这里，不再做判断。 */
export interface LiveSyncDiagnosticView {
    configurationLabel: string;
    endpointLabel: string;
    remoteTypeLabel: string;
    protocolVersionLabel: string;
    nodeIdLabel: string;
    acceptedNodesLabel: string;
    acceptedLabel: string;
    /** true/false；null = 远端里程碑不可读或本机 node id 未知。 */
    milestoneAccepted: boolean | null;
    /** 「远端里程碑尚未接受本机」的显著提示；不满足条件时为 null。 */
    alert: string | null;
    hint: string | null;
    lastPullLabel: string;
    lastPushLabel: string;
    error: string | null;
    /** 逐条 tweak 差异（本机值 vs 云端值），供同步区列表展示。 */
    tweakDiffRows: LiveSyncTweakDiffRow[];
    /** 远端 PREFERRED 状态的中文标签。 */
    remotePreferredStatusLabel: string;
    /** true / false / null（未知）：复制器最近一次是否因 tweak 不一致中止。 */
    tweakSettingsMismatched: boolean | null;
    /** 是否存在必须用户显式确认的差异。 */
    tweakAlignRequired: boolean;
}

export interface LiveSyncActionResult {
    ok: boolean;
    message: string;
}

/** UI 按钮的最小接口，便于在单测里用假按钮验证「执行中禁用」。 */
export interface BusyButtonLike {
    setDisabled(value: boolean): void;
    setButtonText(value: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function shortId(id: string): string {
    return id.length > 12 ? id.slice(0, 8) + "…" : id;
}

function formatDiagnosticTime(value: unknown): string {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "—";
    const ts = value < 100_000_000_000 ? Math.round(value * 1000) : Math.round(value);
    try {
        return new Date(ts).toLocaleString("zh-CN");
    } catch {
        return "—";
    }
}

/**
 * 把连接串脱敏成「协议 + 域名(:端口)」。
 *
 * 只回显主机名，凭据（user:pass@）与路径/查询串一律丢弃；解析失败时退回去掉凭据的原文。
 */
export function maskEndpoint(uri: string | null | undefined): string {
    const raw = text(uri);
    if (!raw) return "";
    const withoutCredentials = raw.replace(/\/\/[^@/\s]*@/, "//");
    try {
        const parsed = new URL(withoutCredentials);
        if (parsed.hostname) {
            return parsed.protocol + "//" + parsed.hostname + (parsed.port ? ":" + parsed.port : "");
        }
    } catch {
        // 非标准连接串，走下面的兜底。
    }
    const stripped = withoutCredentials.split(/[?#]/)[0];
    return stripped.length > 120 ? stripped.slice(0, 120) + "…" : stripped;
}

export interface ConfiguredRemoteInfo {
    configurationId: string | null;
    configurationName: string | null;
    endpoint: string | null;
    remoteType: string | null;
}

/**
 * 从 LiveSync 设置里读出「当前活动档案」的展示信息。
 *
 * 端点优先取活动档案 uri（SettingService 保存时会把顶层明文 couchDB_* 清空，
 * 顶层字段可能为空），档案缺失时退回顶层 couchDB_URI。
 */
export function readConfiguredRemote(settings: unknown): ConfiguredRemoteInfo {
    if (!isRecord(settings)) {
        return { configurationId: null, configurationName: null, endpoint: null, remoteType: null };
    }
    const configurationId = text(settings.activeConfigurationId) || null;
    const remoteType = text(settings.remoteType) || null;
    let configurationName: string | null = null;
    let endpoint: string | null = null;
    const configurations = isRecord(settings.remoteConfigurations) ? settings.remoteConfigurations : null;
    if (configurationId && configurations && isRecord(configurations[configurationId])) {
        const profile = configurations[configurationId];
        configurationName = text(profile.name) || null;
        endpoint = maskEndpoint(text(profile.uri)) || null;
    }
    if (!endpoint) {
        endpoint = maskEndpoint(text(settings.couchDB_URI)) || null;
    }
    return { configurationId, configurationName, endpoint, remoteType };
}

export interface LiveSyncSettingsFingerprint {
    customChunkSize: number | null;
    hashAlg: string | null;
    chunkSplitterVersion: string | null;
    remoteType: string | null;
}

/**
 * 关键同步设置指纹。
 *
 * 这几个键决定「两台设备能不能对同一个远端握手」：customChunkSize / hashAlg /
 * chunkSplitterVersion 是 must-match 参数，remoteType 决定走 CouchDB 还是对象存储。
 * 全部是非敏感配置，可随诊断上传；凭据键（couchDB_USER / couchDB_PASSWORD /
 * 完整 couchDB_URI）一律不进这里。
 */
export function buildSettingsFingerprint(settings: unknown): LiveSyncSettingsFingerprint {
    const record = isRecord(settings) ? settings : {};
    return {
        customChunkSize:
            typeof record.customChunkSize === "number" && Number.isFinite(record.customChunkSize)
                ? Math.round(record.customChunkSize)
                : null,
        hashAlg: text(record.hashAlg) || null,
        chunkSplitterVersion: text(record.chunkSplitterVersion) || null,
        remoteType: describeFingerprintRemoteType(record.remoteType),
    };
}

/**
 * 诊断指纹里的远端类型：把 LiveSync 的 CouchDB 规范空串（`RemoteTypes.REMOTE_COUCHDB === ""`）
 * 翻译成人类可读的 `couchdb`。
 *
 * 这样用户下次上传诊断时，`settings_fingerprint.remoteType` 能**直接证明**
 * 2.0.18 自愈生效（remoteType: couchdb），而不会把正常的 CouchDB 显示成 null。
 * 键缺失 / 为 null 仍然上报 null —— 那才是真的没配好。
 */
function describeFingerprintRemoteType(value: unknown): string | null {
    if (value === "") return "couchdb";
    return text(value) || null;
}

/**
 * 可上传的 LiveSync 诊断摘要。
 *
 * 与 UI 展示模型（LiveSyncDiagnosticView）刻意分开：UI 用中文标签，上传用稳定字段名，
 * 且端点只留域名、node id 只留 8 位短标识、accepted 只留布尔判断 —— 完整连接串与
 * 设备标识原件都不外发。
 */
export interface LiveSyncDiagnosticSummary {
    configuration: string | null;
    endpoint: string | null;
    remote_type: string | null;
    protocol_version: string | number | null;
    node_id_short: string | null;
    milestone_accepted: boolean | null;
    last_pull_at: number | null;
    last_push_at: number | null;
    settings_fingerprint: LiveSyncSettingsFingerprint;
    error: string | null;
    /** 键 → { local, preferred }；空对象 = 逐键全等。 */
    tweak_diff: Record<string, { local: string | number | boolean | null; preferred: string | number | boolean | null }>;
    /** 远端 PREFERRED 读取状态：available / unavailable / not-configured / unsupported。 */
    remote_preferred_status: string | null;
    /** 复制器最近一次握手是否被判 tweak 不一致。 */
    tweak_settings_mismatched: boolean | null;
}

function toEpoch(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

/** 把 LiveSync 诊断输入压成可上传的脱敏摘要。 */
export function buildLiveSyncDiagnosticSummary(
    input: LiveSyncDiagnosticInput,
    settings: unknown
): LiveSyncDiagnosticSummary {
    const localNodeId = text(input.localNodeId);
    const acceptedNodes = Array.isArray(input.acceptedNodes)
        ? input.acceptedNodes.map((node) => text(node)).filter(Boolean)
        : null;
    const milestoneAccepted = acceptedNodes && localNodeId ? acceptedNodes.includes(localNodeId) : null;
    const protocolVersion = input.protocolVersion === undefined ? null : input.protocolVersion;
    return {
        configuration: text(input.configurationName) || text(input.configurationId) || null,
        endpoint: maskEndpoint(text(input.endpoint)) || null,
        remote_type: text(input.remoteType) || null,
        protocol_version: protocolVersion === "" ? null : protocolVersion,
        node_id_short: localNodeId ? localNodeId.slice(0, 8) : null,
        milestone_accepted: milestoneAccepted,
        last_pull_at: toEpoch(input.lastPullAt),
        last_push_at: toEpoch(input.lastPushAt),
        settings_fingerprint: buildSettingsFingerprint(settings),
        error: text(input.error) || null,
        // 诊断必须能自证「为什么复制没开始」：这三个字段就是 tweak 握手阶段的可读证据。
        tweak_diff: buildTweakDiffRecord(input.tweakDiff ?? []),
        remote_preferred_status: text(input.remotePreferredStatus) || null,
        tweak_settings_mismatched:
            typeof input.tweakSettingsMismatched === "boolean" ? input.tweakSettingsMismatched : null,
    };
}

/**
 * 汇总 LiveSync 诊断。
 *
 * 核心判断：远端里程碑的 accepted_nodes 是否包含本机 node id。
 * 不含时给出显著中文提示（alert），这正是本次「一个文件都下不来」的根因。
 */
export function summarizeSyncDiagnostics(input: LiveSyncDiagnosticInput): LiveSyncDiagnosticView {
    const configurationId = text(input.configurationId);
    const configurationName = text(input.configurationName);
    const endpoint = text(input.endpoint);
    const remoteType = text(input.remoteType);
    const localNodeId = text(input.localNodeId);
    const acceptedNodes = Array.isArray(input.acceptedNodes)
        ? input.acceptedNodes.map((node) => text(node)).filter(Boolean)
        : null;
    const error = text(input.error) || null;

    let milestoneAccepted: boolean | null;
    if (!acceptedNodes) {
        milestoneAccepted = null;
    } else if (!localNodeId) {
        milestoneAccepted = null;
    } else {
        milestoneAccepted = acceptedNodes.includes(localNodeId);
    }

    const alert = milestoneAccepted === false
        ? "远端里程碑尚未接受本机：远端 accepted_nodes 中没有本机设备 ID（" + shortId(localNodeId) +
          "）。同步会停在里程碑/配置握手阶段，一个文件都拉不下来。请点击下方「接受远端里程碑 / 加入远端」。"
        : null;

    let hint: string | null = null;
    if (!acceptedNodes) {
        hint = "未能读取远端里程碑，暂时无法判断本机是否已被远端接受。";
    } else if (milestoneAccepted === true) {
        hint = "本机已在远端里程碑的 accepted_nodes 中。";
    } else if (!localNodeId) {
        hint = "本机设备 ID 尚未生成；请先完成一次同步握手后再诊断。";
    }

    const protocolVersion = input.protocolVersion;
    const protocolVersionLabel = protocolVersion === null || protocolVersion === undefined || protocolVersion === ""
        ? "—（未能读取远端 sync_parameters）"
        : String(protocolVersion);

    const tweakDiffRows = buildTweakDiffRows(input.tweakDiff);
    const tweakSettingsMismatched =
        typeof input.tweakSettingsMismatched === "boolean" ? input.tweakSettingsMismatched : null;

    return {
        configurationLabel: configurationName || configurationId || "未配置",
        endpointLabel: endpoint || "未配置",
        remoteTypeLabel: remoteType || "未知",
        protocolVersionLabel,
        nodeIdLabel: localNodeId ? shortId(localNodeId) : "—",
        acceptedNodesLabel: acceptedNodes && acceptedNodes.length ? acceptedNodes.map(shortId).join("、") : "—",
        acceptedLabel: milestoneAccepted === true ? "已接受" : milestoneAccepted === false ? "未接受" : "未知",
        milestoneAccepted,
        alert,
        hint,
        lastPullLabel: formatDiagnosticTime(input.lastPullAt),
        lastPushLabel: formatDiagnosticTime(input.lastPushAt),
        error,
        tweakDiffRows,
        remotePreferredStatusLabel: describeRemotePreferredStatus(input.remotePreferredStatus),
        tweakSettingsMismatched,
        tweakAlignRequired: tweakDiffRows.some((row) => row.kind === "incompatible"),
    };
}

/**
 * 把内部差异列表翻成同步区可展示的行。
 *
 * kind 由键本身决定（重新分类可避免上游传入不一致的分级）。
 */
export function buildTweakDiffRows(
    diffs: readonly TweakAlignmentDiff[] | null | undefined
): LiveSyncTweakDiffRow[] {
    return (diffs ?? []).map((diff) => ({
        key: diff.key,
        label: tweakKeyLabel(diff.key),
        local: describeTweakValue(diff.local),
        preferred: describeTweakValue(diff.preferred),
        kind: classifyTweakKey(diff.key),
    }));
}

/** 远端 PREFERRED 读取状态的中文标签。 */
export function describeRemotePreferredStatus(status: string | null | undefined): string {
    const value = text(status);
    switch (value) {
        case "available":
            return "已读取";
        case "not-configured":
            return "云端未保存同步参数";
        case "unavailable":
            return "读取失败（网络或版本不可用）";
        case "unsupported":
            return "当前远端类型不支持";
        default:
            return "未检查";
    }
}

/**
 * 唯一的推荐动作：存在 incompatible 差异时，用户必须显式确认后才能与云端对齐。
 *
 * 差异为空、或只有可由自愈静默处理的 compatible-lossy 差异时返回 null ——
 * 此时不该给用户任何额外按钮。
 */
export function tweakAlignmentAction(
    view: Pick<LiveSyncDiagnosticView, "tweakDiffRows" | "tweakAlignRequired">
): LiveSyncTweakAlignAction | null {
    if (!view.tweakAlignRequired) return null;
    const hasEncrypt = view.tweakDiffRows.some((row) => row.key === "encrypt");
    const keys = view.tweakDiffRows.map((row) => row.key).join("、");
    return {
        id: "align-tweaks",
        label: hasEncrypt ? "与云端对齐并关闭本机端到端加密" : "与云端对齐同步参数",
        icon: "shield-alert",
        description: hasEncrypt
            ? "本机开启了端到端加密而云端是明文，复制会被中止。对齐会关闭本机 E2EE、按云端参数重建本地同步库。"
            : "本机与云端的同步参数不一致（" + keys + "），复制会被中止。对齐会按云端参数重建本地同步库。",
        risk: "danger",
        confirmMessage: hasEncrypt
            ? "本地开启了端到端加密，云端是明文，复制会被中止；与云端对齐会关闭本地 E2EE 并重建本地同步库（本地未同步内容会被云端覆盖）。"
            : "本地与云端的同步参数不一致（" + keys + "），复制会被中止；与云端对齐会按云端参数重建本地同步库（本地未同步内容会被云端覆盖）。",
        runningLabel: "正在与云端对齐…",
        successMessage: "已与云端对齐同步参数，并已触发一次拉取。",
    };
}

/** 应按当前诊断呈现的动作；「接受远端里程碑」只在确认未接受时出现。 */
export function visibleLiveSyncActions(view: Pick<LiveSyncDiagnosticView, "milestoneAccepted">): LiveSyncActionDescriptor[] {
    if (view.milestoneAccepted === false) return [...LIVESYNC_ACTIONS];
    return LIVESYNC_ACTIONS.filter((action) => action.id !== "accept-milestone");
}

/** 把任意异常转成一句可展示的中文原因（不静默）。 */
export function describeLiveSyncError(error: unknown): string {
    if (error instanceof Error) {
        const message = text(error.message);
        return message || text(error.name) || "未知错误";
    }
    return text(error) || "未知错误，请查看 OsyC 日志";
}

/**
 * 执行一个动作。
 *
 * 危险动作（danger / critical）必须先经 confirm 明确同意；confirm 返回 false 或抛异常时
 * 一律取消，且**不会**调用任何端口方法。端口抛出的异常被折叠成带中文前缀的失败信息。
 */
export async function runLiveSyncAction(
    id: LiveSyncActionId,
    port: LiveSyncActionPort,
    confirm: (message: string) => Promise<boolean>
): Promise<LiveSyncActionResult> {
    const action = LIVESYNC_ACTIONS.find((item) => item.id === id);
    if (!action) return { ok: false, message: "未知的同步操作，已取消。" };
    if (action.risk !== "safe") {
        let approved = false;
        try {
            approved = await confirm(action.confirmMessage ?? action.description);
        } catch {
            approved = false;
        }
        if (!approved) {
            return { ok: false, message: "已取消「" + action.label + "」：未确认危险操作。" };
        }
    }
    try {
        await port[ACTION_METHOD[id]]();
        return { ok: true, message: action.successMessage };
    } catch (error) {
        return { ok: false, message: action.label + "失败：" + describeLiveSyncError(error) };
    }
}

/**
 * 执行期间禁用按钮并显示进行中，结束后无论成败都恢复。
 * finally 保证异常路径也会恢复，避免按钮永久卡在禁用态。
 */
export async function withBusyButton<T>(
    button: BusyButtonLike,
    label: string,
    runningLabel: string,
    task: () => Promise<T>
): Promise<T> {
    button.setDisabled(true);
    button.setButtonText(runningLabel);
    try {
        return await task();
    } finally {
        button.setDisabled(false);
        button.setButtonText(label);
    }
}
