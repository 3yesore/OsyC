import { writable, get, type Writable } from "svelte/store";
import { requestUrl } from "@/deps.ts";
import type { ActiveNoteSnapshot } from "./activeNoteContext";
import { osycLogger } from "@/osyc/serviceFeatures/osycLogger";
import { createTaskClientId, ensureTaskClientId, mergeProgressEvents, mergeResponseText, type AgentProgressEvent } from "./conversationModel";

export type AITaskStatus =
    | "queued" | "running" | "done" | "failed"
    | "awaiting_confirmation" | "conflict" | "interrupted"
    | "failed_zero_cost" | "delivery_failed" | "cancelled";
export type ArtifactDeliveryStatus = "pending" | "delivered" | "failed" | "conflict";

export interface ArtifactMetadata {
    path: string;
    size: number;
    sha256: string;
}

export interface AIAgentSyncState {
    enabled: boolean;
    status: "ok" | "degraded" | "failed" | "unknown";
    vault_name: string | null;
    last_pull_at: number | null;
    last_push_at: number | null;
    staleness_seconds: number | null;
    last_error_code: string | null;
    last_error_hint: string | null;
    conflict_state: "none" | "pending" | "needs_user_action";
    gate: "ready" | "degraded" | "blocked";
    activation_id: string | null;
    total_files?: number | null;
    markdown_files?: number | null;
    empty_files?: number | null;
    unreadable_files?: number | null;
    checked_at?: number | null;
}

export interface ArtifactWriteResult {
    ok: boolean;
    conflict?: boolean;
    message?: string;
}

export interface ConfirmationPrompt {
    /** Internal one-time credential; never render this field in UI. */
    token: string;
    action: string;
    payload?: Record<string, unknown>;
    summary_sha256: string;
    expires_at: number;
}

/** Normalise backend Unix timestamps for JavaScript Date (milliseconds). */
export function normaliseExpireAt(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
    return value < 100_000_000_000 ? Math.round(value * 1000) : Math.round(value);
}

/**
 * Normalize service URLs saved by older OsyC builds.
 *
 * Releases before the Hermes migration documented `/osyc` as the API base,
 * while the current service exposes its contract at the origin root. Only
 * that exact legacy path is removed; arbitrary self-hosted subpaths remain
 * untouched.
 */
export function normaliseApiBase(value: string): string {
    const trimmed = value.trim().replace(/\/+$/, "");
    if (!trimmed) return "";
    try {
        const parsed = new URL(trimmed);
        if ((parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.pathname.toLowerCase() === "/osyc") {
            return parsed.origin;
        }
    } catch {
        // Preserve non-URL values for the existing validation/error path.
    }
    return trimmed;
}

/**
 * 后端写入 progress 的"同步回传失败"标记。
 *
 * 后端（app/agent/syncing.py）在推送失败时写死这段文本，这里靠它判断要不要显示重试按钮。
 * 改动任一侧都要同步另一侧 —— 若将来改成结构化字段，两端一起换。
 */
export const SYNC_FAILED_MARK = "同步回传失败";

export function isSyncFailed(task: AITask): boolean {
    return task.status === "done"
        && task.deliveryStatus !== "delivered"
        && (task.progress ?? "").includes(SYNC_FAILED_MARK);
}

/** agent 提出的主题片段建议。name 已 slug 化（即 .obsidian/snippets/<name>.css 的基名）。 */
export interface AISnippet {
    name: string;
    css: string;
    reason: string;
}

export interface AITask {
    taskId: string;
    /** Client identity used while the server task_id is not assigned yet. */
    clientId?: string;
    message: string;
    status: AITaskStatus;
    progress?: string;
    filesChanged?: string[];
    estCost?: number;
    actualCost?: number;
    // 真实模型按 token × 单价折算的「元等值额度」消耗（从会员/Pro 的 model_quota 扣），
    // 与积分为两本账。真实计费接通前恒为 undefined。
    modelQuotaCost?: number;
    error?: string;
    // agent 提出的同步设置调整建议（后端只提建议，要等用户确认才应用）
    settingsPatch?: Record<string, unknown>;
    // agent 提出的主题片段建议（Pro 权益）：仅当用户确认后才在客户端落盘并启用，
    // 后端只提建议、不直接写 vault。name 已 slug 化、css 已做安全校验。
    themeSnippet?: AISnippet | null;
    progressEvents?: AgentProgressEvent[];
    artifacts?: ArtifactMetadata[];
    syncState?: AIAgentSyncState;
    /** Cumulative visible model response, rendered in the assistant message stream. */
    responseText?: string;
    confirmation?: ConfirmationPrompt;
    deliveryStatus?: ArtifactDeliveryStatus;
    deliveryError?: string;
    errorCode?: number;
    createdAt: number;
    finishedAt?: number;
}

export interface AISchedule {
    job_id: string;
    schedule: string;
    message: string;
    enabled: boolean;
    last_status?: string | null;
    next_run_at?: number | null;
}

export interface AIAgentState {
    activated: boolean;
    credits: number;
    // 折合人民币，由后端换算后下发。插件端不要自己算 ——
    // 汇率在两端各写死一份迟早不一致。
    creditsYuan: number;
    /** Remaining model quota in yuan, independent from task credits. */
    modelQuota: number;
    expireAt: number | null;
    model: string;
    powerSave: boolean;
    // 档位：base / member / pro。后端 activate 下发，插件只展示不判断权限。
    plan: PlanType;
    // 账户权益（后端 entitlements_for 算好下发）。含会员专属技能、设备数上限、
    // 定时开关、会员赠送的模型额度等。插件端只读展示，不据此做权限门禁
    // （门禁以后端为准，避免被本地篡改绕过）。
    entitlements: AIEntitlements | null;
    // Cloud-Vault（会员/Pro 权益）：用户态备份/恢复。available 由 loadCloudVault 懒加载探测，
    // snapshots 缓存自服务端，重启后会重新拉取，不依赖持久化中那份旧值。
    cloudVault: AICloudVault;
    // LiveSync 只读同步快照：用于给 Hermes / UI 回显同步状态，不是权限开关。
    syncState: AIAgentSyncState;
    // 设备管理 + 自带 Key（账户弹窗内懒加载）。devices 缓存自服务端。
    devices: AIDeviceState;
    // 是否已看过「OsyC 是什么 / 能做什么」首次引导。看过/跳过后置 true 并持久化。
    onboarded: boolean;
}

/** 后端下发的权益结构（见 ai-backend/app/plans.py:Entitlements.to_dict）。 */
export interface AIEntitlements {
    sync: boolean;
    aiTasks: boolean;
    schedules: boolean;
    cloudVault: boolean;
    cloudQuotaMb: number;
    maxDevices: number;
    skills: string[];
    // 元等值的 DS-V4-Flash 模型额度（会员/Pro 赠送），与积分为两本账。
    modelQuota: number;
    // 后续扩展权益（extra 字典），用索引访问。
    [key: string]: unknown;
}

export type PlanType = "base" | "member" | "pro";

/** Cloud-Vault 快照元信息（后端 list_snapshots 下发）。 */
export interface AISnapshot {
    snapshot_id: string;
    /** Unix 秒 */
    created_at: number;
    note_count: number;
}

/** 单台设备（后端 /api/devices 下发）。byo_key 原文不回传。 */
export interface AIDevice {
    device_id: string;
    activated_at: number;
    last_seen_at: number;
    is_current: boolean;
    has_byo_key: boolean;
}

/** 设备管理用户态状态。devices 缓存自服务端，进入账户弹窗时懒加载。 */
export interface AIDeviceState {
    devices: AIDevice[];
    max_devices: number;
    loading: boolean;
    error: string | null;
}


/**
 * Cloud-Vault 用户态状态。available 由 loadCloudVault 懒加载探测：
 * 会员/Pro 档且服务端已配 R2 = true，否则为 false 并带原因（基础档不可用 / 服务端未启用）。
 * snapshots 缓存自服务端，重启后会重新拉取，不依赖持久化中那份旧值。
 */
export interface AICloudVault {
    available: boolean;
    reason: string;
    snapshots: AISnapshot[];
    busy: boolean;
    /** 最近一次操作的提示（成功/失败信息），空表示无 */
    message: string;
}

const DEFAULT_SYNC_STATE: AIAgentSyncState = {
    enabled: false,
    status: "unknown",
    vault_name: null,
    last_pull_at: null,
    last_push_at: null,
    staleness_seconds: null,
    last_error_code: null,
    last_error_hint: null,
    conflict_state: "none",
    gate: "degraded",
    activation_id: null,
};

export interface AIAgentSettings {
    apiBase: string;
    token: string;
}

export interface OsyCRuntimeInfo {
    backend_release_id: string;
    hermes_adapter_version: string;
    artifact_intent_policy_version: string;
    streaming_protocol_version: string;
    plugin_compatibility: string;
}

function parseSemver(value: string): [number, number, number] | null {
    const match = /^\s*(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?\s*$/.exec(value);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareSemver(left: [number, number, number], right: [number, number, number]): number {
    for (let index = 0; index < left.length; index++) {
        if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
    }
    return 0;
}

/** Check the compact comparator range emitted by the OsyC backend. */
export function isRuntimeCompatible(version: string, range: string): boolean {
    const current = parseSemver(version);
    if (!current || !range.trim()) return false;
    const comparators = range.trim().split(/\s+/);
    return comparators.every((comparator) => {
        const match = /^(>=|<=|>|<|=)?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/.exec(comparator);
        if (!match) return false;
        const target = parseSemver(match[2]);
        if (!target) return false;
        const result = compareSemver(current, target);
        switch (match[1] ?? "=") {
            case ">=": return result >= 0;
            case "<=": return result <= 0;
            case ">": return result > 0;
            case "<": return result < 0;
            default: return result === 0;
        }
    });
}

declare const MANIFEST_VERSION: string | undefined;
const CURRENT_PLUGIN_VERSION = typeof MANIFEST_VERSION === "string" ? MANIFEST_VERSION : "1.0.73";

const DEFAULT_STATE: AIAgentState = {
    activated: false,
    credits: 0,
    creditsYuan: 0,
    modelQuota: 0,
    expireAt: null,
    model: "auto",
    powerSave: true,
    plan: "base",
    entitlements: null,
    cloudVault: { available: false, reason: "", snapshots: [], busy: false, message: "" },
    syncState: { ...DEFAULT_SYNC_STATE },
    devices: { devices: [], max_devices: 3, loading: false, error: null },
    onboarded: false,
};

export function normalizeSyncState(raw: unknown): AIAgentSyncState {
    if (!raw || typeof raw !== "object") return { ...DEFAULT_SYNC_STATE };
    const value = raw as Record<string, unknown>;
    const status = value.status === "ok" || value.status === "degraded" || value.status === "failed" || value.status === "unknown"
        ? value.status
        : DEFAULT_SYNC_STATE.status;
    const conflictState = value.conflict_state === "pending" || value.conflict_state === "needs_user_action" || value.conflict_state === "none"
        ? value.conflict_state
        : DEFAULT_SYNC_STATE.conflict_state;
    const gate = value.gate === "ready" || value.gate === "degraded" || value.gate === "blocked"
        ? value.gate
        : DEFAULT_SYNC_STATE.gate;
    const toFiniteInt = (input: unknown): number | null =>
        typeof input === "number" && Number.isFinite(input) && input > 0 ? Math.round(input) : null;
    const toNonNegativeInt = (input: unknown): number | null =>
        typeof input === "number" && Number.isFinite(input) && input >= 0 ? Math.round(input) : null;
    return {
        enabled: Boolean(value.enabled),
        status,
        vault_name: typeof value.vault_name === "string" && value.vault_name.trim() ? value.vault_name.trim() : null,
        last_pull_at: toFiniteInt(value.last_pull_at),
        last_push_at: toFiniteInt(value.last_push_at),
        staleness_seconds: typeof value.staleness_seconds === "number" && Number.isFinite(value.staleness_seconds) && value.staleness_seconds >= 0
            ? Math.round(value.staleness_seconds)
            : null,
        last_error_code: typeof value.last_error_code === "string" && value.last_error_code.trim() ? value.last_error_code.trim() : null,
        last_error_hint: typeof value.last_error_hint === "string" && value.last_error_hint.trim() ? value.last_error_hint.trim() : null,
        conflict_state: conflictState,
        gate,
        activation_id: typeof value.activation_id === "string" && value.activation_id.trim() ? value.activation_id.trim() : null,
        total_files: toNonNegativeInt(value.total_files),
        markdown_files: toNonNegativeInt(value.markdown_files),
        empty_files: toNonNegativeInt(value.empty_files),
        unreadable_files: toNonNegativeInt(value.unreadable_files),
        checked_at: toFiniteInt(value.checked_at),
    };
}

/** Prefer a newer handshake over a stale snapshot returned by /api/status. */
export function mergeSyncState(current: AIAgentSyncState, incoming: AIAgentSyncState): AIAgentSyncState {
    const currentChecked = current.checked_at ?? 0;
    const incomingChecked = incoming.checked_at ?? 0;
    const differentActivation = Boolean(current.activation_id && incoming.activation_id && current.activation_id !== incoming.activation_id);
    const incomingIsOlder = currentChecked > 0 && (incomingChecked === 0 || incomingChecked < currentChecked);
    if (current.gate === "ready" && differentActivation && incomingIsOlder) return current;
    return incoming;
}

// Keep the first several polls responsive so visible Hermes deltas appear in
// the assistant message as they arrive; power-save mode still backs off after that.
const POLL_INITIAL_DELAY_MS = 1000;
const POLL_POWER_SAVE_DELAY_MS = 30000;
const MAX_TRANSIENT_RETRIES = 3;

/**
 * AI 代执行服务。
 *
 * 负责：卡密激活、指令下发、任务轮询、积分管理。
 * 后端接口契约见 outputs/Obsidian插件开发设计文档.md
 *
 * 未配置 apiBase 时进入 MOCK 模式，便于 UI 开发与联调前演示。
 */
export class CmdAIAgent {
    tasks: Writable<AITask[]> = writable([]);
    schedules: Writable<AISchedule[]> = writable([]);
    state: Writable<AIAgentState> = writable({ ...DEFAULT_STATE });

    settings: AIAgentSettings = {
        apiBase: "",
        token: "",
    };

    /** Safe server fingerprint used for diagnostics and release-mixing detection. */
    runtimeInfo: OsyCRuntimeInfo | null = null;
    private runtimeInfoLoaded = false;

    /** 本机标识，首次启动时生成并持久化，用于"最多 3 台设备"的限制 */
    deviceId: string = "";

    /**
     * 应用 LiveSync 同步配置的回调（由插件接线层注入，那里才拿得到 core.services）。
     *
     * 传 setup URI 与解密钥匙。约定：**钥匙就是卡密本身**
     * —— 后端用 card_key 加密，插件端本地已有 card_key，无需再传一次，
     * 用户也只需记住一个东西。改动任一侧都要同步另一侧。
     */
    applySetupUri?: (setupUri: string, passphrase: string) => Promise<boolean>;
    // 应用 agent 提出的设置调整建议。后端只提建议，真正改配置发生在客户端，
    // 而且会再过一遍白名单 —— 不信任后端传来的任何键。
    applySettingsPatch?: (patch: Record<string, unknown>) => Promise<{
        applied: number;
        rejected: { key: string; reason: string }[];
    }>;
    // 应用 agent 提出的主题片段建议（Pro 权益）。真正写入 vault + 启用发生在客户端
    // （useAIAgentUI 里用 app.customCss），后端只提建议、不直接落盘。
    applyThemeSnippet?: (snippet: AISnippet) => Promise<{ ok: boolean; message: string }>;
    /** Injected by the Obsidian wiring layer to write verified server artifacts. */
    artifactWriter?: (artifact: ArtifactMetadata, data: Uint8Array) => Promise<ArtifactWriteResult>;

    /** 同步是否已由激活流程自动配好 */
    syncConfigured = false;

    private polling = new Set<string>();
    private stopped = false;
    private lifecycleGeneration = 0;
    private lastSyncHandshakeStatus = 0;

    get isMock(): boolean {
        return !this.settings.apiBase;
    }

    configure(apiBase: string, token: string) {
        this.settings.apiBase = normaliseApiBase(apiBase);
        this.settings.token = token;
        this.runtimeInfo = null;
        this.runtimeInfoLoaded = false;
        this.stopped = false;
        if (token) {
            this.state.update((s) => ({ ...s, activated: true }));
        }
    }

    /** 用新卡密给当前账户续费。额度并进原账户，记忆/vault 全部保留。 */
    async recharge(cardKey: string): Promise<{ ok: boolean; message: string }> {
        if (this.isMock) {
            this.state.update((s) => ({ ...s, credits: s.credits + 1000 }));
            return { ok: true, message: "MOCK 模式：已模拟充值 1000 积分" };
        }
        const { status, data } = await this.call("/api/recharge", "POST", { card_key: cardKey });
        if (status >= 400) {
            const msg =
                status === 400
                    ? "卡密无效或已被使用"
                    : status === 409
                      ? "该卡密已被激活过，不能用于充值"
                      : this.describeError(status);
            return { ok: false, message: msg };
        }
        const res = data as { credits?: number; expire_at?: number } | null;
        // 充值后额度变了，折合金额要重新问后端拿
        this.state.update((s) => ({
            ...s,
            credits: res?.credits ?? s.credits,
            expireAt: normaliseExpireAt(res?.expire_at) ?? s.expireAt,
        }));
        await this.refreshStatus();
        return { ok: true, message: "充值成功，额度和有效期已延长" };
    }

    // ---------- 定时任务 ----------

    private async call(
        path: string,
        method: string,
        body?: unknown
    ): Promise<{ status: number; data: unknown }> {
        const res = await requestUrl({
            url: `${this.settings.apiBase}${path}`,
            method,
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.settings.token}`,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            throw: false,
        });
        let data: unknown = null;
        try {
            data = await res.json;
        } catch {
            data = null;
        }
        return { status: res.status, data };
    }

    async loadSchedules(): Promise<void> {
        if (this.isMock) {
            // 定时能力已改为 agent 自然语言驱动，UI 不再单独暴露定时入口。
            // 后端定时 API 仍保留，agent 收到"每天整理"这类指令时自行配置。
            this.schedules.set([]);
            return;
        }
        const { status, data } = await this.call("/api/schedules", "GET");
        if (status < 400 && Array.isArray(data)) {
            this.schedules.set(data as AISchedule[]);
        }
    }

    async createSchedule(schedule: string, message: string): Promise<{ ok: boolean; message: string }> {
        if (this.isMock) {
            this.schedules.update((l) => [
                { job_id: `mock-${Date.now()}`, schedule, message, enabled: true },
                ...l,
            ]);
            return { ok: true, message: "MOCK 模式：已模拟创建" };
        }
        const { status, data } = await this.call("/api/schedules", "POST", { schedule, message });
        if (status >= 400) return { ok: false, message: this.describeError(status) };
        this.schedules.update((l) => [data as AISchedule, ...l]);
        return { ok: true, message: "定时任务已创建" };
    }

    async toggleSchedule(job: AISchedule): Promise<void> {
        const action = job.enabled ? "pause" : "resume";
        if (this.isMock) {
            this.schedules.update((l) =>
                l.map((s) => (s.job_id === job.job_id ? { ...s, enabled: !s.enabled } : s))
            );
            return;
        }
        const { status } = await this.call(`/api/schedules/${job.job_id}/${action}`, "POST");
        if (status < 400) {
            this.schedules.update((l) =>
                l.map((s) => (s.job_id === job.job_id ? { ...s, enabled: !s.enabled } : s))
            );
        }
    }

    async removeSchedule(jobId: string): Promise<void> {
        if (this.isMock) {
            this.schedules.update((l) => l.filter((s) => s.job_id !== jobId));
            return;
        }
        const { status } = await this.call(`/api/schedules/${jobId}`, "DELETE");
        if (status < 400) {
            this.schedules.update((l) => l.filter((s) => s.job_id !== jobId));
        }
    }

    // ---------- Cloud-Vault（会员/Pro 权益：用户态备份 / 恢复） ----------

    /** 加载快照列表并探测可用性。基础档 / R2 未配时 available=false 并带原因。 */
    async loadCloudVault(): Promise<void> {
        if (this.isMock) {
            // MOCK 合成两条假快照，便于 UI 联调（不真正连 R2）
            this.state.update((s) => ({
                ...s,
                cloudVault: {
                    available: true,
                    reason: "",
                    busy: false,
                    message: "",
                    snapshots: [
                        { snapshot_id: "mock-1", created_at: Date.now() - 86400_000, note_count: 12 },
                        { snapshot_id: "mock-2", created_at: Date.now() - 3600_000, note_count: 15 },
                    ],
                },
            }));
            return;
        }
        const state = get(this.state);
        const cloudEnabled = state.entitlements?.cloudVault ?? (state.plan === "member" || state.plan === "pro");
        if (!cloudEnabled) {
            this.state.update((s) => ({
                ...s,
                cloudVault: { available: false, reason: "基础档不可用", busy: false, message: "", snapshots: [] },
            }));
            return;
        }
        try {
            const { status, data } = await this.call("/api/cloud/snapshots", "GET");
            if (status === 403) {
                this.state.update((s) => ({
                    ...s,
                    cloudVault: { available: false, reason: "基础档不可用", busy: false, message: "", snapshots: [] },
                }));
                return;
            }
            if (status === 503) {
                this.state.update((s) => ({
                    ...s,
                    cloudVault: { available: false, reason: "服务端未启用 Cloud-Vault", busy: false, message: "", snapshots: [] },
                }));
                return;
            }
            if (status >= 400) {
                this.state.update((s) => ({
                    ...s,
                    cloudVault: { ...s.cloudVault, available: false, reason: this.describeError(status) },
                }));
                return;
            }
            const snaps = (data as { snapshots?: AISnapshot[] } | null)?.snapshots ?? [];
            this.state.update((s) => ({
                ...s,
                cloudVault: { available: true, reason: "", busy: false, message: "", snapshots: snaps },
            }));
        } catch {
            this.state.update((s) => ({
                ...s,
                cloudVault: { ...s.cloudVault, available: false, reason: "网络错误" },
            }));
        }
    }

    /** 整库加密备份到 R2。成功后把新快照插到列表最前。 */
    async cloudBackup(): Promise<{ ok: boolean; message: string }> {
        if (this.isMock) {
            const snap: AISnapshot = { snapshot_id: `mock-${Date.now()}`, created_at: Date.now(), note_count: 15 };
            this.state.update((s) => ({
                ...s,
                cloudVault: { ...s.cloudVault, snapshots: [snap, ...s.cloudVault.snapshots], message: "MOCK 模式：已模拟备份" },
            }));
            return { ok: true, message: "MOCK 模式：已模拟备份" };
        }
        this.state.update((s) => ({ ...s, cloudVault: { ...s.cloudVault, busy: true, message: "" } }));
        try {
            const { status, data } = await this.call("/api/cloud/backup", "POST");
            if (status >= 400) {
                const msg =
                    status === 403
                        ? "基础档不可用"
                        : status === 503
                          ? "服务端未启用 Cloud-Vault"
                          : status === 502
                            ? "备份失败，请稍后再试"
                            : this.describeError(status);
                this.state.update((s) => ({
                    ...s,
                    cloudVault: { ...s.cloudVault, busy: false, available: status !== 403 && status !== 503, reason: msg, message: msg },
                }));
                return { ok: false, message: msg };
            }
            const snap = (data as AISnapshot) ?? { snapshot_id: `b-${Date.now()}`, created_at: Date.now(), note_count: 0 };
            const msg = `备份成功，共 ${snap.note_count} 篇笔记`;
            this.state.update((s) => ({
                ...s,
                cloudVault: { ...s.cloudVault, busy: false, available: true, message: msg, snapshots: [snap, ...s.cloudVault.snapshots] },
            }));
            return { ok: true, message: msg };
        } catch {
            this.state.update((s) => ({ ...s, cloudVault: { ...s.cloudVault, busy: false, message: "网络错误" } }));
            return { ok: false, message: "网络错误" };
        }
    }

    /**
     * 从快照恢复笔记到本地库。默认不覆盖已有笔记（与端点安全默认一致）；
     * overwrite=true 时允许覆盖。返回实际写入的篇数（0 表示本地均已是最新）。
     */
    async cloudRestore(snapshotId: string, overwrite = false): Promise<{ ok: boolean; message: string }> {
        if (this.isMock) {
            return { ok: true, message: "MOCK 模式：已模拟恢复（未真正写入本地库）" };
        }
        this.state.update((s) => ({ ...s, cloudVault: { ...s.cloudVault, busy: true, message: "" } }));
        try {
            const { status, data } = await this.call("/api/cloud/restore", "POST", {
                snapshot_id: snapshotId,
                overwrite,
            });
            if (status >= 400) {
                const msg =
                    status === 400
                        ? "快照不存在或卡密不匹配"
                        : status === 403
                          ? "基础档不可用"
                          : status === 503
                            ? "服务端未启用 Cloud-Vault"
                            : this.describeError(status);
                this.state.update((s) => ({ ...s, cloudVault: { ...s.cloudVault, busy: false, message: msg } }));
                return { ok: false, message: msg };
            }
            const restored = (data as { restored?: number } | null)?.restored ?? 0;
            const msg = restored === 0 ? "恢复完成，本地笔记均已是最新（无需写入）" : `已恢复 ${restored} 篇笔记到本地库`;
            this.state.update((s) => ({ ...s, cloudVault: { ...s.cloudVault, busy: false, message: msg } }));
            return { ok: true, message: msg };
        } catch {
            this.state.update((s) => ({ ...s, cloudVault: { ...s.cloudVault, busy: false, message: "网络错误" } }));
            return { ok: false, message: "网络错误" };
        }
    }

    /**
     * 拉取设备列表与上限。未激活或 MOCK 模式合成假数据便于联调。
     * 真实模式调用 GET /api/devices，byo_key 原文不回传，只给 has_byo_key 标记。
     */
    async loadDevices(): Promise<void> {
        if (this.isMock) {
            const now = Date.now();
            this.state.update((s) => ({
                ...s,
                devices: {
                    devices: [
                        { device_id: this.deviceId, activated_at: now - 86400_000, last_seen_at: now, is_current: true, has_byo_key: false },
                        { device_id: "mock-phone", activated_at: now - 172800_000, last_seen_at: now - 3600_000, is_current: false, has_byo_key: false },
                    ],
                    max_devices: 3,
                    loading: false,
                    error: null,
                },
            }));
            return;
        }
        try {
            const { status, data } = await this.call("/api/devices", "GET");
            if (status >= 400) {
                this.state.update((s) => ({ ...s, devices: { ...s.devices, loading: false, error: this.describeError(status) } }));
                return;
            }
            const d = (data as { devices?: AIDevice[]; max_devices?: number } | null) ?? null;
            this.state.update((s) => ({
                ...s,
                devices: {
                    devices: d?.devices ?? [],
                    max_devices: d?.max_devices ?? 3,
                    loading: false,
                    error: null,
                },
            }));
        } catch {
            this.state.update((s) => ({ ...s, devices: { ...s.devices, loading: false, error: "网络错误" } }));
        }
    }

    /** 撤销一台设备（使其 token 失效）。不能撤销当前设备。成功后会重新拉取列表。 */
    async revokeDevice(deviceId: string): Promise<{ ok: boolean; message: string }> {
        if (this.isMock) {
            this.state.update((s) => ({
                ...s,
                devices: { ...s.devices, devices: s.devices.devices.filter((x) => x.device_id !== deviceId) },
            }));
            return { ok: true, message: "MOCK：已撤销该设备" };
        }
        try {
            const { status } = await this.call("/api/devices/revoke", "POST", { device_id: deviceId });
            if (status >= 400) {
                const msg = status === 400 ? "不能撤销当前设备" : status === 404 ? "设备不存在" : this.describeError(status);
                return { ok: false, message: msg };
            }
            await this.loadDevices();
            return { ok: true, message: "已撤销该设备" };
        } catch {
            return { ok: false, message: "网络错误" };
        }
    }

    /** 保存当前设备的自带 LLM key。填了即代表该设备走自带额度。成功后会重新拉取列表。 */
    async saveByoKey(key: string): Promise<{ ok: boolean; message: string }> {
        const k = key.trim();
        if (!k) return { ok: false, message: "请输入 Key" };
        if (this.isMock) {
            this.state.update((s) => ({
                ...s,
                devices: { ...s.devices, devices: s.devices.devices.map((x) => (x.is_current ? { ...x, has_byo_key: true } : x)) },
            }));
            return { ok: true, message: "MOCK：已保存自带 Key" };
        }
        try {
            const { status } = await this.call("/api/devices/byokey", "POST", { byo_key: k });
            if (status >= 400) return { ok: false, message: this.describeError(status) };
            await this.loadDevices();
            return { ok: true, message: "已保存（本机将走自带额度）" };
        } catch {
            return { ok: false, message: "网络错误" };
        }
    }

    /** 清空当前设备的自带 LLM key（恢复走 OsyC 额度）。成功后会重新拉取列表。 */
    async clearByoKey(): Promise<{ ok: boolean; message: string }> {
        if (this.isMock) {
            this.state.update((s) => ({
                ...s,
                devices: { ...s.devices, devices: s.devices.devices.map((x) => (x.is_current ? { ...x, has_byo_key: false } : x)) },
            }));
            return { ok: true, message: "MOCK：已清空" };
        }
        try {
            const { status } = await this.call("/api/devices/byokey", "DELETE");
            if (status >= 400) return { ok: false, message: this.describeError(status) };
            await this.loadDevices();
            return { ok: true, message: "已清空（恢复走 OsyC 额度）" };
        } catch {
            return { ok: false, message: "网络错误" };
        }
    }

    /** 把后端下发的 snake_case 权益字典规整成插件用的 camelCase 结构。 */
    private normalizeEntitlements(raw: unknown): AIEntitlements | null {
        if (!raw || typeof raw !== "object") return null;
        const e = raw as Record<string, unknown>;
        const result: AIEntitlements = {
            sync: Boolean(e.sync),
            aiTasks: Boolean(e.ai_tasks),
            schedules: Boolean(e.schedules),
            cloudVault: Boolean(e.cloud_vault ?? false),
            cloudQuotaMb: Number(e.cloud_quota_mb ?? 0),
            maxDevices: Number(e.max_devices ?? 2),
            skills: Array.isArray(e.skills) ? e.skills.filter((x): x is string => typeof x === "string") : [],
            modelQuota: Number(e.model_quota ?? 0),
        };
        // 其余扩展权益原样保留（extra 字典）
        for (const [k, v] of Object.entries(e)) {
            if (!["sync", "ai_tasks", "schedules", "cloud_vault", "cloud_quota_mb", "max_devices", "skills", "model_quota"].includes(k)) {
                result[k] = v;
            }
        }
        return result;
    }

    /** 激活卡密 */
    async activate(cardKey: string): Promise<{ ok: boolean; message: string }> {
        this.stopped = false;
        const deviceId = this.deviceId;
        if (this.isMock) {
            this.settings.token = "mock-token";
            this.state.set({
                activated: true,
                credits: 1280,
                creditsYuan: 5.49,
                modelQuota: 0,
                expireAt: Date.now() + 30 * 24 * 3600 * 1000,
                model: "DeepSeek-V4-Flash",
                powerSave: true,
                plan: "base",
                syncState: { ...DEFAULT_SYNC_STATE },
                onboarded: get(this.state).onboarded,
                entitlements: {
                    sync: true,
                    aiTasks: true,
                    schedules: false,
                    cloudVault: false,
                    cloudQuotaMb: 0,
                    maxDevices: 2,
                    skills: [],
                    modelQuota: 0,
                },
                cloudVault: get(this.state).cloudVault,
                devices: get(this.state).devices,
            });
            return { ok: true, message: "MOCK 模式：已模拟激活" };
        }
        try {
            const res = await requestUrl({
                url: `${this.settings.apiBase}/api/activate`,
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ card_key: cardKey, device_id: deviceId }),
                throw: false,
            });
            if (res.status >= 400) {
                return { ok: false, message: this.describeError(res.status) };
            }
            const data = await res.json;
            this.settings.token = data.token;
            this.state.set({
                activated: true,
                credits: data.credits ?? 0,
                creditsYuan: data.credits_yuan ?? 0,
                expireAt: normaliseExpireAt(data.expire_at),
                modelQuota: Number(data.model_quota ?? 0),
                model: data.model ?? "auto",
                powerSave: get(this.state).powerSave,
                plan: (data.plan as PlanType) ?? "base",
                syncState: { ...DEFAULT_SYNC_STATE },
                onboarded: get(this.state).onboarded,
                entitlements: this.normalizeEntitlements(data.entitlements),
                cloudVault: get(this.state).cloudVault,
                devices: get(this.state).devices,
            });

            // 自动配置同步：这一步省掉"用户自己配 LiveSync"这个最大的流失点。
            // 失败不阻断激活 —— 用户仍可手动配置，只是多一道手续。
            let suffix = "";
            if (data.setup_uri && this.applySetupUri) {
                try {
                    this.syncConfigured = await this.applySetupUri(data.setup_uri, cardKey);
                    suffix = this.syncConfigured ? "，同步已自动配置" : "，但同步配置失败，请手动设置";
                } catch {
                    suffix = "，但同步配置失败，请手动设置";
                }
            }
            // 配置写入后再做一次服务端握手，避免使用激活前的旧同步配置。
            const handshake = await this.runSyncHandshake(this.newSyncActivationId());
            if (handshake) {
                this.state.update((s) => ({ ...s, syncState: handshake }));
            }
            void this.refreshStatus();
            return { ok: true, message: `激活成功${suffix}` };
        } catch {
            return { ok: false, message: this.networkErrorMessage() };
        }
    }

    private async runSyncHandshake(activationId: string): Promise<AIAgentSyncState | null> {
        try {
            const { status, data } = await this.call("/api/sync/handshake", "POST", { activation_id: activationId });
            this.lastSyncHandshakeStatus = status;
            if (status >= 400) return null;
            return normalizeSyncState(data);
        } catch {
            this.lastSyncHandshakeStatus = 0;
            return null;
        }
    }

    private newSyncActivationId(): string {
        try {
            if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
                return `sync-${crypto.randomUUID()}`;
            }
        } catch {
            // Older mobile WebViews may expose crypto without randomUUID.
        }
        return `sync-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    /**
     * Refresh the server-side LiveSync snapshot without invoking Hermes or charging credits.
     * A fresh id intentionally bypasses a cached result from an older failed handshake.
     */
    async refreshSync(): Promise<{ ok: boolean; message: string }> {
        if (!get(this.state).activated || !this.settings.token) {
            return { ok: false, message: "请先激活卡密" };
        }
        if (this.isMock) {
            const syncState = { ...get(this.state).syncState, enabled: true, status: "ok" as const, gate: "ready" as const, activation_id: this.newSyncActivationId() };
            this.state.update((s) => ({ ...s, syncState }));
            return { ok: true, message: "已刷新同步状态" };
        }
        const syncState = await this.runSyncHandshake(this.newSyncActivationId());
        if (!syncState) {
            return {
                ok: false,
                message: this.lastSyncHandshakeStatus === 404
                    ? "当前服务地址未部署同步握手，请切换到 OsyC 服务器地址后重新激活"
                    : "同步状态刷新失败，请稍后重试",
            };
        }
        this.state.update((s) => ({ ...s, syncState }));
        return {
            ok: true,
            message: syncState.gate === "ready" ? "同步已就绪" : "同步已刷新，但当前处于降级状态",
        };
    }

    /** 刷新积分与到期信息 */
    async refreshStatus(): Promise<void> {
        if (this.isMock || !this.settings.token) return;
        try {
            const res = await requestUrl({
                url: `${this.settings.apiBase}/api/status`,
                method: "GET",
                headers: { Authorization: `Bearer ${this.settings.token}` },
                throw: false,
            });
            if (res.status < 400) {
                const data = await res.json;
                const syncStateRaw = data && typeof data === "object" ? (data as { sync_state?: unknown }).sync_state : undefined;
                this.state.update((s) => ({
                    ...s,
                    credits: data.credits ?? s.credits,
                    // 后端统一换算的折合金额，必须读。否则真实用户一直显示 0 元额度。
                    creditsYuan: data.credits_yuan ?? s.creditsYuan,
                    expireAt: normaliseExpireAt(data.expire_at) ?? s.expireAt,
                    modelQuota: Number(data.model_quota ?? s.modelQuota),
                    syncState: syncStateRaw === undefined
                        ? s.syncState
                        : mergeSyncState(s.syncState, normalizeSyncState(syncStateRaw)),
                }));
                void this.refreshRuntimeInfo();
            }
        } catch {
            // 状态刷新失败不打断用户操作，静默处理
        }
    }

    /** Read and record a non-secret runtime fingerprint without blocking chat. */
    async refreshRuntimeInfo(): Promise<OsyCRuntimeInfo | null> {
        if (this.isMock || !this.settings.token || this.runtimeInfoLoaded) return this.runtimeInfo;
        this.runtimeInfoLoaded = true;
        try {
            const res = await requestUrl({
                url: `${this.settings.apiBase}/api/runtime-info`,
                method: "GET",
                headers: { Authorization: `Bearer ${this.settings.token}` },
                throw: false,
            });
            if (res.status >= 400) {
                osycLogger.warn("OsyC 服务端运行时指纹不可用", { status: res.status });
                return null;
            }
            const value = (await res.json) as Partial<OsyCRuntimeInfo>;
            const fields: (keyof OsyCRuntimeInfo)[] = [
                "backend_release_id", "hermes_adapter_version", "artifact_intent_policy_version",
                "streaming_protocol_version", "plugin_compatibility",
            ];
            if (fields.some((field) => typeof value[field] !== "string" || !value[field]!.trim())) {
                osycLogger.warn("OsyC 服务端运行时指纹字段不完整");
                return null;
            }
            this.runtimeInfo = value as OsyCRuntimeInfo;
            osycLogger.info("OsyC 服务端运行时指纹", {
                backend_release_id: this.runtimeInfo.backend_release_id,
                hermes_adapter_version: this.runtimeInfo.hermes_adapter_version,
                artifact_intent_policy_version: this.runtimeInfo.artifact_intent_policy_version,
                streaming_protocol_version: this.runtimeInfo.streaming_protocol_version,
                plugin_compatibility: this.runtimeInfo.plugin_compatibility,
            });
            return this.runtimeInfo;
        } catch {
            osycLogger.warn("OsyC 服务端运行时指纹请求失败");
            return null;
        }
    }

    /** 下发指令 */
    async send(message: string, activeNote?: ActiveNoteSnapshot): Promise<void> {
        const clientId = createTaskClientId();
        const task: AITask = {
            taskId: this.isMock ? clientId : "",
            clientId,
            message,
            status: "queued",
            createdAt: Date.now(),
        };

        // 先入列，保证 UI 立即反馈
        this.tasks.update((list) => [task, ...list]);

        const compatibility = this.runtimeInfo?.plugin_compatibility;
        if (compatibility && !isRuntimeCompatible(CURRENT_PLUGIN_VERSION, compatibility)) {
            this.failTask(clientId, "服务端版本不兼容，请更新插件后重试", 409);
            return;
        }

        if (this.isMock) {
            void this.runMockTask(task.taskId);
            return;
        }

        try {
            const res = await requestUrl({
                url: `${this.settings.apiBase}/api/send`,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.settings.token}`,
                },
                body: JSON.stringify(activeNote ? { message, active_note: activeNote } : { message }),
                throw: false,
            });
            if (res.status >= 400) {
                this.failTask(clientId, await this.describeResponseError(res, res.status), res.status);
                return;
            }
            const data = await res.json;
            this.tasks.update((list) => list.map((t) =>
                t.clientId === clientId ? { ...t, taskId: data.task_id, estCost: data.est_cost } : t
            ));
            void this.pollTask(data.task_id);
        } catch {
            this.failTask(clientId, this.networkErrorMessage());
        }
    }

    /** 轮询任务状态：3 秒间隔，10 次后降为 30 秒（省电）。临时错误采用有限退避重试。 */
    private async pollTask(taskId: string): Promise<void> {
        if (this.polling.has(taskId)) return;
        this.polling.add(taskId);
        const generation = this.lifecycleGeneration;
        let round = 0;
        let transientRetries = 0;
        try {
            while (true) {
                const interval =
                    transientRetries > 0
                        ? Math.min(POLL_INITIAL_DELAY_MS * 2 ** (transientRetries - 1), POLL_POWER_SAVE_DELAY_MS)
                        : round < 10
                          ? POLL_INITIAL_DELAY_MS
                          : POLL_POWER_SAVE_DELAY_MS;
                await new Promise((r) => window.setTimeout(r, interval));
                if (this.stopped || generation !== this.lifecycleGeneration) return;
                round++;

                let res: { status: number; json: unknown };
                try {
                    res = await requestUrl({
                        url: `${this.settings.apiBase}/api/task/${taskId}`,
                        method: "GET",
                        headers: { Authorization: `Bearer ${this.settings.token}` },
                        throw: false,
                    });
                } catch {
                    if (transientRetries < MAX_TRANSIENT_RETRIES) {
                        transientRetries++;
                        continue;
                    }
                    this.failTask(taskId, this.networkErrorMessage());
                    return;
                }
                if (res.status >= 400) {
                    if (this.isTransientStatus(res.status) && transientRetries < MAX_TRANSIENT_RETRIES) {
                        transientRetries++;
                        continue;
                    }
                    this.failTask(taskId, await this.describeResponseError(res, res.status), res.status);
                    return;
                }
                transientRetries = 0;
                const data = (await res.json) as {
                    status: AITaskStatus;
                    progress?: string;
                    files_changed?: string[];
                    actual_cost?: number;
                    model_quota_cost?: number;
                    settings_patch?: Record<string, unknown>;
                    theme_snippet?: AISnippet | null;
                    progress_events?: AgentProgressEvent[];
                    artifacts?: ArtifactMetadata[];
                    response_text?: string;
                    confirmation?: ConfirmationPrompt | null;
                    sync_state?: unknown;
                };
                const syncStateRaw = data && typeof data === "object" ? data.sync_state : undefined;
                const incomingSyncState = syncStateRaw === undefined
                    ? get(this.state).syncState
                    : mergeSyncState(get(this.state).syncState, normalizeSyncState(syncStateRaw));
                this.tasks.update((list) =>
                    list.map((t) =>
                        t.taskId === taskId
                            ? {
                                  ...t,
                                  status: data.status,
                                  // Task responses may be partial while Hermes is
                                  // streaming. Preserve fields omitted by older
                                  // gateways or an intermediate polling frame.
                                  progress: data.progress ?? t.progress,
                                  filesChanged: data.files_changed ?? t.filesChanged,
                                  actualCost: data.actual_cost ?? t.actualCost,
                                  modelQuotaCost: data.model_quota_cost ?? t.modelQuotaCost,
                                  settingsPatch: data.settings_patch !== undefined ? data.settings_patch : t.settingsPatch,
                                  themeSnippet: data.theme_snippet !== undefined ? data.theme_snippet : t.themeSnippet,
                                  progressEvents: mergeProgressEvents(t.progressEvents, data.progress_events),
                                  artifacts: data.artifacts ?? t.artifacts ?? [],
                                  syncState: incomingSyncState,
                                  // Keep an already received response when older gateways omit
                                  // response_text on a later polling response.
                                  responseText: mergeResponseText(t.responseText, data.response_text,
                                      ["done", "failed", "conflict", "interrupted", "failed_zero_cost", "delivery_failed", "cancelled"].includes(data.status)),
                                  confirmation: data.confirmation !== undefined ? data.confirmation ?? undefined : t.confirmation,
                                  deliveryStatus: data.status === "done" && (data.artifacts?.length ?? t.artifacts?.length ?? 0) > 0 ? "pending" : t.deliveryStatus,
                              }
                            : t
                    )
                );
                this.state.update((s) => ({ ...s, syncState: incomingSyncState }));
                if (["done", "failed", "conflict", "interrupted", "failed_zero_cost", "delivery_failed", "cancelled", "awaiting_confirmation"].includes(data.status)) {
                    if (data.status !== "awaiting_confirmation") {
                        this.tasks.update((list) =>
                            list.map((t) => (t.taskId === taskId ? { ...t, finishedAt: Date.now() } : t))
                        );
                    }
                    if (data.status === "done" && (data.artifacts?.length ?? 0) > 0) {
                        await this.deliverArtifacts(taskId, data.artifacts ?? [], generation);
                    }
                    if (["done", "failed"].includes(data.status) && !this.stopped && generation === this.lifecycleGeneration) {
                        void this.refreshStatus();
                    }
                    return;
                }
            }
        } finally {
            this.polling.delete(taskId);
        }
    }

    /** Confirm one pending Vault mutation. This consumes the server token once. */
    async confirmTask(taskId: string): Promise<{ ok: boolean; message: string }> {
        const task = get(this.tasks).find((item) => item.taskId === taskId);
        const confirmation = task?.confirmation;
        if (!task || task.status !== "awaiting_confirmation" || !confirmation) {
            return { ok: false, message: "没有可确认的操作" };
        }
        try {
            const res = await requestUrl({
                url: `${this.settings.apiBase}/api/task/${encodeURIComponent(taskId)}/confirm`,
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.settings.token}` },
                body: JSON.stringify({ token: confirmation.token, summary_sha256: confirmation.summary_sha256 }),
                throw: false,
            });
            if (res.status >= 400) {
                const message = res.status === 409 ? "确认已失效或笔记发生冲突" : await this.describeResponseError(res, res.status);
                this.tasks.update((list) => list.map((item) => item.taskId === taskId
                    ? { ...item, status: res.status === 409 ? "conflict" : "failed_zero_cost", error: message, confirmation: undefined, finishedAt: Date.now() }
                    : item));
                return { ok: false, message };
            }
            const body = (await res.json) as { status?: AITaskStatus; result?: { message?: string } };
            const result = body.result ?? {};
            const changed = Object.values(result).filter((value): value is string =>
                typeof value === "string" && value.toLowerCase().endsWith(".md")
            );
            this.tasks.update((list) => list.map((item) => item.taskId === taskId
                ? { ...item, status: body.status === "done" ? "done" : "running", confirmation: undefined, filesChanged: changed.length ? changed : item.filesChanged, progress: body.status === "done" ? "完成" : item.progress, responseText: result.message ?? item.responseText, finishedAt: body.status === "done" ? Date.now() : undefined }
                : item));
            return { ok: true, message: result.message ?? "操作已确认" };
        } catch {
            return { ok: false, message: this.networkErrorMessage() };
        }
    }

    /** Cancel the pending mutation without charging or touching the Vault. */
    async cancelConfirmation(taskId: string): Promise<{ ok: boolean; message: string }> {
        const task = get(this.tasks).find((item) => item.taskId === taskId);
        if (!task || task.status !== "awaiting_confirmation") return { ok: false, message: "没有可取消的操作" };
        if (this.isMock) {
            this.tasks.update((list) => list.map((item) => item.taskId === taskId ? { ...item, status: "cancelled", confirmation: undefined, progress: "已取消", finishedAt: Date.now() } : item));
            return { ok: true, message: "已取消" };
        }
        try {
            const res = await requestUrl({
                url: `${this.settings.apiBase}/api/task/${encodeURIComponent(taskId)}/cancel-confirmation`,
                method: "POST",
                headers: { Authorization: `Bearer ${this.settings.token}` },
                throw: false,
            });
            if (res.status >= 400) return { ok: false, message: await this.describeResponseError(res, res.status) };
            this.tasks.update((list) => list.map((item) => item.taskId === taskId ? { ...item, status: "cancelled", confirmation: undefined, progress: "已取消", finishedAt: Date.now() } : item));
            return { ok: true, message: "已取消" };
        } catch {
            return { ok: false, message: this.networkErrorMessage() };
        }
    }

    private async deliverArtifacts(
        taskId: string,
        artifacts: ArtifactMetadata[],
        generation = this.lifecycleGeneration,
    ): Promise<void> {
        if (!this.artifactWriter || artifacts.length === 0) return;
        const delivered: ArtifactMetadata[] = [];
        try {
            for (const artifact of artifacts) {
                if (this.stopped || generation !== this.lifecycleGeneration) return;
                if (!artifact || !artifact.path || artifact.size <= 0 || !/^[a-f0-9]{64}$/.test(artifact.sha256)) {
                    throw new Error("结果文件元数据无效");
                }
                const res = await requestUrl({
                    url: `${this.settings.apiBase}/api/task/${encodeURIComponent(taskId)}/artifact?path=${encodeURIComponent(artifact.path)}`,
                    method: "GET",
                    headers: { Authorization: `Bearer ${this.settings.token}` },
                    throw: false,
                });
                if (res.status >= 400) throw new Error(res.status === 409 ? "服务器结果已变化" : "下载结果失败");
                const bytes = new Uint8Array(res.arrayBuffer);
                const headerSize = Number(res.headers?.["content-length"] ?? bytes.byteLength);
                const headerHash = String(res.headers?.["x-osyc-artifact-sha256"] ?? "").toLowerCase();
                const digest = await this.sha256(bytes);
                if (bytes.byteLength !== artifact.size || headerSize !== artifact.size || digest !== artifact.sha256 || (headerHash && headerHash !== digest)) {
                    throw new Error("结果校验失败");
                }
                if (this.stopped || generation !== this.lifecycleGeneration) return;
                if (!get(this.tasks).find((task) => task.taskId === taskId)?.responseText && artifact.path.toLowerCase().endsWith(".md")) {
                    try {
                        const responseText = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
                        if (responseText) this.setResponseText(taskId, responseText);
                    } catch {
                        // The server already enforces UTF-8; a client decoder failure must not
                        // prevent a verified artifact from being written to the Vault.
                    }
                }
                const written = await this.artifactWriter(artifact, bytes);
                if (!written.ok) {
                    this.setDelivery(taskId, written.conflict ? "conflict" : "failed", written.message ?? "手机写入失败");
                    return;
                }
                delivered.push(artifact);
            }
            if (this.stopped || generation !== this.lifecycleGeneration) return;
            const ack = await requestUrl({
                url: `${this.settings.apiBase}/api/task/${encodeURIComponent(taskId)}/artifact-ack`,
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.settings.token}` },
                body: JSON.stringify({ artifacts: delivered }),
                throw: false,
            });
            if (ack.status >= 400) throw new Error("结果确认失败");
            this.setDelivery(taskId, "delivered");
        } catch (error) {
            osycLogger.error("任务结果写入笔记库失败", error);
            this.setDelivery(taskId, "failed", error instanceof Error ? error.message : "手机写入失败");
        }
    }

    private setDelivery(taskId: string, status: ArtifactDeliveryStatus, error?: string): void {
        this.tasks.update((list) => list.map((task) => task.taskId === taskId ? { ...task, deliveryStatus: status, deliveryError: error } : task));
    }

    private setResponseText(taskId: string, responseText: string): void {
        this.tasks.update((list) => list.map((task) => task.taskId === taskId ? { ...task, responseText } : task));
    }

    private async sha256(bytes: Uint8Array): Promise<string> {
        const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer as ArrayBuffer);
        return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    }

    /** MOCK：模拟任务流转，用于 UI 开发 */
    private async runMockTask(taskId: string) {
        const generation = this.lifecycleGeneration;
        const tick = (patch: Partial<AITask>) =>
            this.tasks.update((list) => list.map((t) => (t.taskId === taskId ? { ...t, ...patch } : t)));

        await new Promise((r) => window.setTimeout(r, 800));
        if (this.stopped || generation !== this.lifecycleGeneration) return;
        tick({ status: "running", progress: "读取 4 个文件...", estCost: 80 });
        await new Promise((r) => window.setTimeout(r, 2000));
        if (this.stopped || generation !== this.lifecycleGeneration) return;
        tick({ status: "running", progress: "正在生成整理结果..." });
        await new Promise((r) => window.setTimeout(r, 1500));
        if (this.stopped || generation !== this.lifecycleGeneration) return;
        tick({
            status: "done",
            progress: "完成",
            filesChanged: ["整理/本周笔记-主题分类.md", "整理/待办汇总.md"],
            actualCost: 120,
            finishedAt: Date.now(),
        });
        this.state.update((s) => ({ ...s, credits: Math.max(0, s.credits - 120) }));
    }

    private failTask(taskId: string, error: string, errorCode?: number) {
        this.tasks.update((list) =>
            list.map((t) =>
                t.taskId === taskId || t.clientId === taskId
                    ? { ...t, status: "failed", error, errorCode, finishedAt: Date.now() }
                    : t
            )
        );
    }

    private describeError(status: number): string {
        switch (status) {
            case 401:
                return "未激活或登录已失效，请重新输入卡密";
            case 402:
                return "积分不足，请充值后再试";
            case 403:
                return "设备数量超限（最多 3 台）";
            case 429:
                return "请求过于频繁，请稍后再试";
            default:
                return `服务端错误（${status}）`;
        }
    }

    private async describeResponseError(res: { json: unknown }, status: number): Promise<string> {
        const fallback = this.describeError(status);
        try {
            const body = (await res.json) as { detail?: unknown; message?: unknown; error?: unknown } | null;
            const detail = body?.detail ?? body?.message ?? body?.error;
            if (typeof detail === "string" && detail.trim()) {
                const safe = detail.trim().replace(/[\r\n]+/g, " ").slice(0, 240);
                return `${fallback}：${safe}`;
            }
        } catch {
            // Some gateways return an empty/non-JSON body; keep the stable status text.
        }
        return fallback;
    }

    private isTransientStatus(status: number): boolean {
        return status === 408 || status === 425 || status === 429 || status >= 500;
    }

    private networkErrorMessage(): string {
        return "网络连接失败，请检查网络后重试";
    }

    /** 同步回传失败后手动重试。不额外扣积分 —— 这条指令已经付过费了。 */
    async retryPush(taskId: string): Promise<{ ok: boolean; message: string }> {
        if (this.isMock) {
            // 演示模式：直接抹掉失败标记，方便看 UI 效果
            this.tasks.update((list) =>
                list.map((t) => (t.taskId === taskId ? { ...t, progress: "已重新同步到你的笔记库" } : t))
            );
            return { ok: true, message: "MOCK 模式：已模拟重试成功" };
        }
        const existingTask = get(this.tasks).find((task) => task.taskId === taskId);
        if (existingTask?.artifacts?.length && this.artifactWriter) {
            this.setDelivery(taskId, "pending");
            await this.deliverArtifacts(taskId, existingTask.artifacts, this.lifecycleGeneration);
            const latest = get(this.tasks).find((task) => task.taskId === taskId);
            return latest?.deliveryStatus === "delivered"
                ? { ok: true, message: "已重新写入你的笔记库" }
                : { ok: false, message: latest?.deliveryError ?? "手机写入失败" };
        }
        try {
            const res = await requestUrl({
                url: `${this.settings.apiBase}/api/task/${taskId}/retry-push`,
                method: "POST",
                headers: { Authorization: `Bearer ${this.settings.token}` },
                throw: false,
            });
            if (res.status >= 400) {
                return { ok: false, message: res.status === 502 ? "回传仍失败，请稍后再试" : this.describeError(res.status) };
            }
            this.tasks.update((list) =>
                list.map((t) =>
                    t.taskId === taskId ? { ...t, progress: "已重新同步到你的笔记库" } : t
                )
            );
            return { ok: true, message: "已重新同步，刷新一下笔记库就能看到" };
        } catch {
            return { ok: false, message: this.networkErrorMessage() };
        }
    }

    /**
     * 恢复未完成的任务轮询。
     *
     * 手机 App 会被系统挂起或杀掉，任务绝不能只留在内存里（设计文档"坑 2"）。
     * 重启后从这里把 queued/running 的任务重新接上轮询，
     * 用户看到的才是"任务还在跑"而不是一片空白。
     */
    resumePending(): void {
        for (const task of get(this.tasks)) {
            if (task.status === "queued" || task.status === "running") {
                void this.pollTask(task.taskId);
            }
        }
    }

    /** 用持久化的状态覆盖当前内存状态（App 重启恢复用） */
    restore(state: Partial<AIAgentState> | undefined, tasks: AITask[]): void {
        const incoming = state ?? {};
        this.state.set({
            ...DEFAULT_STATE,
            ...incoming,
            syncState: normalizeSyncState(incoming.syncState),
            cloudVault: { ...DEFAULT_STATE.cloudVault, ...(incoming.cloudVault ?? {}) },
            devices: { ...DEFAULT_STATE.devices, ...(incoming.devices ?? {}) },
        });
        this.tasks.set(Array.isArray(tasks) ? tasks.map(ensureTaskClientId) : []);
    }

    clearFinished() {
        this.tasks.update((list) => list.filter((t) => t.status === "queued" || t.status === "running"));
    }

    /** 标记已看过首次引导。state.subscribe → schedulePersist 会自动落盘，无需手动 persist。 */
    markOnboarded() {
        if (get(this.state).onboarded) return;
        this.state.update((s) => ({ ...s, onboarded: true }));
    }

    /** 注销本机：清空凭据，回到未激活状态 */
    deactivate() {
        this.stop();
        this.settings.token = "";
        this.tasks.set([]);
        this.state.set({ ...DEFAULT_STATE });
    }

    /** 停止所有后台轮询。插件卸载、账户注销时调用。 */
    stop(): void {
        this.stopped = true;
        this.lifecycleGeneration++;
        this.polling.clear();
    }
}
