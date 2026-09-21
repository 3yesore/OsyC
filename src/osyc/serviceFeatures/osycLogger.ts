export type OsyCLogLevel = "info" | "warn" | "error";

export interface OsyCLogEntry {
    timestamp: string;
    level: OsyCLogLevel;
    message: string;
}

/**
 * 最近一次 API 失败的摘要。
 *
 * 只保留「发生时间 + 请求路径 + 状态码」：响应正文可能含用户数据或凭据，
 * 一律不进缓冲、更不进诊断载荷。路径本身也要过脱敏（查询串里可能有 token）。
 */
export interface OsyCApiFailure {
    at: string;
    path: string;
    status: number;
}

const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_MAX_API_FAILURES = 20;

/**
 * 统一脱敏入口：任何进入日志缓冲或诊断载荷的文本都必须先过这里。
 *
 * 覆盖四类泄漏面：
 * - `key: value` / `key=value` 形式的凭据键（含 token / passphrase / 卡密相关的英文键名）；
 * - `sk-` / `pk-` / `spt_` 前缀的密钥串；
 * - `Authorization: Bearer …`；
 * - URL 查询串里的凭据，以及**完整 setup URI**（只记脱敏占位符，绝不外发）。
 */
export function redactSensitiveText(value: string): string {
    return value
        // setup URI 必须最先处理：它本身可能带 `?setup=` 查询串，若先走查询串
        // 规则会被拆成两段，URI 前缀消失后剩下的密文就漏出去了。
        .replace(/(?:osyc|obsidian):\/\/\S+/gi, "[REDACTED_SETUP_URI]")
        .replace(
            /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|card[_-]?key|cardkey|authorization|password|passphrase|secret|token)\s*[:=]\s*)(["']?)[^,\s}"']+/gi,
            "$1$2[REDACTED]"
        )
        .replace(/\b(?:sk|pk|spt)_?[A-Za-z0-9_-]{6,}\b/g, "[REDACTED_KEY]")
        .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
        .replace(/([?&](?:token|key|secret|password|authorization|passphrase|setup)=)[^&\s]+/gi, "$1[REDACTED]")
        // 邮箱也是个人身份信息：日志与诊断载荷里一律只留「首字符 + 域名首字符 + 顶级域」。
        .replace(
            /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9-])[A-Za-z0-9.-]*\.([A-Za-z]{2,})/g,
            "$1***@$2***.$3"
        );
}

function formatDetail(detail: unknown): string {
    if (detail instanceof Error) {
        return redactSensitiveText(detail.stack || detail.message || detail.name);
    }
    if (typeof detail === "string") return redactSensitiveText(detail);
    try {
        return redactSensitiveText(JSON.stringify(detail));
    } catch {
        return "[unserializable detail]";
    }
}

export class OsyCLogger {
    private readonly maxEntries: number;
    private readonly maxApiFailures: number;
    private readonly buffer: OsyCLogEntry[] = [];
    private readonly apiFailureBuffer: OsyCApiFailure[] = [];

    constructor(options: { maxEntries?: number; maxApiFailures?: number } = {}) {
        this.maxEntries = Math.max(1, Math.floor(options.maxEntries ?? DEFAULT_MAX_ENTRIES));
        this.maxApiFailures = Math.max(1, Math.floor(options.maxApiFailures ?? DEFAULT_MAX_API_FAILURES));
    }

    info(message: string, detail?: unknown): void {
        this.push("info", message, detail);
    }

    warn(message: string, detail?: unknown): void {
        this.push("warn", message, detail);
    }

    error(message: string, detail?: unknown): void {
        this.push("error", message, detail);
    }

    entries(): OsyCLogEntry[] {
        return this.buffer.map((entry) => ({ ...entry }));
    }

    /** 最近 N 条 API 失败摘要（只读快照）。 */
    apiFailures(): OsyCApiFailure[] {
        return this.apiFailureBuffer.map((entry) => ({ ...entry }));
    }

    /** 记录一次 API 失败：只留路径与状态码，绝不记录响应正文。 */
    recordApiFailure(path: string, status: number): void {
        this.apiFailureBuffer.push({
            at: new Date().toISOString(),
            path: redactSensitiveText(path),
            status,
        });
        if (this.apiFailureBuffer.length > this.maxApiFailures) {
            this.apiFailureBuffer.splice(0, this.apiFailureBuffer.length - this.maxApiFailures);
        }
    }

    clear(): void {
        this.buffer.length = 0;
        this.apiFailureBuffer.length = 0;
    }

    /**
     * 导出诊断文本。默认导出全部缓冲（容量上限 200 条）；
     * 传 `maxEntries` 可只导出最近 N 条。
     */
    report(maxEntries?: number): string {
        const selected = typeof maxEntries === "number" && maxEntries >= 0
            ? this.buffer.slice(-maxEntries)
            : this.buffer;
        const lines = selected.map(
            (entry) => `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`
        );
        return ["OsyC diagnostic log", `entries=${this.buffer.length}`, ...lines].join("\n");
    }

    private push(level: OsyCLogLevel, message: string, detail?: unknown): void {
        const suffix = detail === undefined ? "" : ` | ${formatDetail(detail)}`;
        this.buffer.push({
            timestamp: new Date().toISOString(),
            level,
            message: redactSensitiveText(`${message}${suffix}`),
        });
        if (this.buffer.length > this.maxEntries) this.buffer.splice(0, this.buffer.length - this.maxEntries);
    }
}

export const osycLogger = new OsyCLogger();
