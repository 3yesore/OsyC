import type { AITask, OsyCRuntimeInfo } from "./CmdAIAgent";
import { maskEndpoint, type LiveSyncDiagnosticSummary } from "./livesyncSyncActions";
import { redactSensitiveText, type OsyCApiFailure } from "@/osyc/serviceFeatures/osycLogger";

export type ErrorReportRequest = (options: { url: string; method: string; headers?: Record<string, string>; body?: string; throw?: boolean }) => Promise<{ status: number; json: unknown | (() => Promise<unknown>) }>;

const MAX_FIELD_LENGTH = 600;
/**
 * 诊断日志上限。
 *
 * 旧值 600 字符（与普通字段共用 bounded）意味着 200 条 ring buffer 永远只能传出
 * 开头一小段，日志上传实际是摆设。服务端 ErrorReportRequest.diagnostics_log 允许
 * 12000 字符，这里取 8000，留出其它字段的余量。
 */
const MAX_LOG_LENGTH = 8000;

function redact(value: string): string {
    return redactSensitiveText(value);
}

function bounded(value: string): string { return redact(value).slice(0, MAX_FIELD_LENGTH); }
function boundedLog(value: string): string { return redact(value).slice(0, MAX_LOG_LENGTH); }

/**
 * 邮箱脱敏：只保留「用户名首字符 + 域名首字符 + 顶级域」。
 * 例：`alice@example.com` → `a***@e***.com`。
 */
export function maskEmailAddress(value: string | null | undefined): string | null {
    const raw = typeof value === "string" ? value.trim() : "";
    if (!raw) return null;
    const at = raw.lastIndexOf("@");
    if (at <= 0) return bounded(raw);
    const local = raw.slice(0, at);
    const domain = raw.slice(at + 1);
    const maskedLocal = local.includes("*") ? local : `${local.slice(0, 1)}***`;
    if (domain.includes("*")) return `${maskedLocal}@${domain}`;
    const dot = domain.lastIndexOf(".");
    if (dot <= 0) return `${maskedLocal}@${domain.slice(0, 1)}***`;
    return `${maskedLocal}@${domain.slice(0, 1)}***${domain.slice(dot)}`;
}

/** 账户档位与脱敏登录态；不含卡密、token、完整邮箱。 */
export interface AccountDiagnosticSummary {
    plan: string;
    activated: boolean;
    /** card = 凭卡密激活；email = 本次运行邮箱会话；none = 未登录。 */
    login: "card" | "email" | "none";
    email_masked: string | null;
}

export type ApiFailureSummary = OsyCApiFailure;

export interface ErrorReportContext {
    pluginVersion: string;
    obsidianVersion: string;
    platform: string;
    runtimeInfo?: OsyCRuntimeInfo | Record<string, unknown> | null;
    diagnosticsLog: string;
    /** 账户档位 + 脱敏登录态。 */
    accountSummary?: AccountDiagnosticSummary | null;
    /** LiveSync 脱敏诊断摘要（含关键设置指纹）。 */
    livesyncSummary?: LiveSyncDiagnosticSummary | null;
    /** 最近 API 失败摘要（路径 + 状态码）。 */
    apiFailures?: readonly ApiFailureSummary[];
}

export interface ErrorReportPayload {
    request_id: string;
    task_id: string;
    error_code: number | null;
    error_summary: string;
    task_status: string;
    plugin_version: string;
    obsidian_version: string;
    platform: string;
    runtime_info: OsyCRuntimeInfo | Record<string, unknown> | null;
    progress_events: Array<{ phase?: string; count?: number }>;
    diagnostics_log: string;
    message_summary: string;
    response_summary: string;
    account_summary: AccountDiagnosticSummary | null;
    livesync_summary: LiveSyncDiagnosticSummary | null;
    api_failures: ApiFailureSummary[];
}

function sanitizeAccountSummary(summary: AccountDiagnosticSummary | null | undefined): AccountDiagnosticSummary | null {
    if (!summary) return null;
    return {
        plan: bounded(String(summary.plan ?? "base")),
        activated: Boolean(summary.activated),
        login: summary.login === "email" ? "email" : summary.login === "none" ? "none" : "card",
        email_masked: maskEmailAddress(summary.email_masked),
    };
}

function sanitizeLiveSyncSummary(summary: LiveSyncDiagnosticSummary | null | undefined): LiveSyncDiagnosticSummary | null {
    if (!summary) return null;
    return {
        configuration: summary.configuration ? bounded(summary.configuration) : null,
        // 兜底再脱敏一次：即使调用方塞进完整连接串（含 user:pass@），上传的也只有域名。
        endpoint: summary.endpoint ? bounded(maskEndpoint(summary.endpoint)) : null,
        remote_type: summary.remote_type ? bounded(summary.remote_type) : null,
        protocol_version:
            typeof summary.protocol_version === "number" ? summary.protocol_version : summary.protocol_version ? bounded(summary.protocol_version) : null,
        node_id_short: summary.node_id_short ? bounded(summary.node_id_short).slice(0, 12) : null,
        milestone_accepted: typeof summary.milestone_accepted === "boolean" ? summary.milestone_accepted : null,
        last_pull_at: summary.last_pull_at ?? null,
        last_push_at: summary.last_push_at ?? null,
        settings_fingerprint: {
            customChunkSize: summary.settings_fingerprint?.customChunkSize ?? null,
            hashAlg: summary.settings_fingerprint?.hashAlg ? bounded(summary.settings_fingerprint.hashAlg) : null,
            chunkSplitterVersion: summary.settings_fingerprint?.chunkSplitterVersion
                ? bounded(summary.settings_fingerprint.chunkSplitterVersion)
                : null,
            remoteType: summary.settings_fingerprint?.remoteType ? bounded(summary.settings_fingerprint.remoteType) : null,
        },
        error: summary.error ? bounded(summary.error) : null,
    };
}

function sanitizeApiFailures(failures: readonly ApiFailureSummary[] | undefined): ApiFailureSummary[] {
    return (failures ?? []).slice(-20).map((failure) => ({
        at: bounded(String(failure.at ?? "")),
        path: bounded(String(failure.path ?? "")),
        status: typeof failure.status === "number" ? failure.status : 0,
    }));
}

export function isDiagnosticEligible(task: AITask): boolean {
    return ["failed", "conflict", "failed_zero_cost", "delivery_failed", "cancelled"].includes(task.status)
        || task.deliveryStatus === "failed" || task.deliveryStatus === "conflict";
}

export function buildErrorReportPayload(task: AITask, context: ErrorReportContext): ErrorReportPayload {
    return {
        request_id: `${task.taskId}-${Date.now()}`,
        task_id: bounded(task.taskId),
        error_code: typeof task.errorCode === "number" ? task.errorCode : null,
        error_summary: bounded(task.error ?? "任务失败"),
        task_status: task.status,
        plugin_version: bounded(context.pluginVersion),
        obsidian_version: bounded(context.obsidianVersion),
        platform: bounded(context.platform),
        runtime_info: context.runtimeInfo ?? null,
        progress_events: (task.progressEvents ?? []).slice(-12).map((event) => ({ phase: event.phase, count: event.count })),
        diagnostics_log: boundedLog(context.diagnosticsLog),
        message_summary: `任务描述已省略（${task.message.length} 字）`,
        response_summary: task.responseText ? `模型回复已省略（${task.responseText.length} 字）` : "无模型回复",
        account_summary: sanitizeAccountSummary(context.accountSummary),
        livesync_summary: sanitizeLiveSyncSummary(context.livesyncSummary),
        api_failures: sanitizeApiFailures(context.apiFailures),
    };
}

export interface ErrorReportRequestOptions {
    confirm: () => boolean | Promise<boolean>;
    request?: ErrorReportRequest;
}

export async function uploadErrorReport(
    apiBase: string,
    token: string,
    task: AITask,
    context: ErrorReportContext,
    options: ErrorReportRequestOptions,
): Promise<{ ok: boolean; message: string; requestId?: string }> {
    if (!(await options.confirm())) return { ok: false, message: "已取消上传诊断" };
    const payload = buildErrorReportPayload(task, context);
    try {
        const request = options.request ?? (globalThis as unknown as { requestUrl?: ErrorReportRequest }).requestUrl;
        if (!request) return { ok: false, message: "诊断上传失败" };
        const response = await request({
            url: `${apiBase.replace(/\/+$/, "")}/api/error-reports`, method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
                "Idempotency-Key": payload.request_id,
            },
            body: JSON.stringify(payload), throw: false,
        });
        let body: unknown = null;
        try { body = typeof response.json === "function" ? await response.json() : await response.json; } catch { /* response may be empty */ }
        const reportId = body && typeof body === "object" && typeof (body as Record<string, unknown>).report_id === "string"
            ? String((body as Record<string, unknown>).report_id) : undefined;
        return response.status < 400
            ? { ok: true, message: reportId ? `诊断已上传，报告编号 ${reportId}` : "诊断已上传，感谢你的反馈", requestId: reportId }
            : { ok: false, message: "诊断上传失败" };
    } catch { return { ok: false, message: "诊断上传失败" }; }
}
