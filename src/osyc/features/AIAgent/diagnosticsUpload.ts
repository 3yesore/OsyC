import type { AITask, OsyCRuntimeInfo } from "./CmdAIAgent";

export type ErrorReportRequest = (options: { url: string; method: string; headers?: Record<string, string>; body?: string; throw?: boolean }) => Promise<{ status: number; json: unknown | (() => Promise<unknown>) }>;

const MAX_FIELD_LENGTH = 600;

function redact(value: string): string {
    return value
        .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|card[_-]?key|authorization|password|secret)\s*[:=]\s*)(["']?)[^,\s}"']+/gi, "$1$2[REDACTED]")
        .replace(/\b(?:sk|pk)-[A-Za-z0-9_-]+\b/g, "[REDACTED_KEY]")
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
}

function bounded(value: string): string { return redact(value).slice(0, MAX_FIELD_LENGTH); }

export interface ErrorReportContext {
    pluginVersion: string;
    obsidianVersion: string;
    platform: string;
    runtimeInfo?: OsyCRuntimeInfo | Record<string, unknown> | null;
    diagnosticsLog: string;
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
        diagnostics_log: bounded(context.diagnosticsLog),
        message_summary: `任务描述已省略（${task.message.length} 字）`,
        response_summary: task.responseText ? `模型回复已省略（${task.responseText.length} 字）` : "无模型回复",
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
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify(payload), throw: false,
        });
        let body: unknown = null;
        try { body = typeof response.json === "function" ? await response.json() : await response.json; } catch { /* response may be empty */ }
        const requestId = body && typeof body === "object" && typeof (body as Record<string, unknown>).request_id === "string"
            ? String((body as Record<string, unknown>).request_id) : undefined;
        return response.status < 400
            ? { ok: true, message: "诊断已上传，感谢你的反馈", requestId }
            : { ok: false, message: "诊断上传失败" };
    } catch { return { ok: false, message: "诊断上传失败" }; }
}
