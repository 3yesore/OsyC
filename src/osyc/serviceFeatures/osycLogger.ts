export type OsyCLogLevel = "info" | "warn" | "error";

export interface OsyCLogEntry {
    timestamp: string;
    level: OsyCLogLevel;
    message: string;
}

const DEFAULT_MAX_ENTRIES = 200;

function redact(value: string): string {
    return value
        .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|card[_-]?key|authorization|password|secret)\s*[:=]\s*)(["']?)[^,\s}"']+/gi, "$1$2[REDACTED]")
        .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[REDACTED_API_KEY]")
        .replace(/([?&](?:token|key|secret|password|authorization)=)[^&\s]+/gi, "$1[REDACTED]");
}

function formatDetail(detail: unknown): string {
    if (detail instanceof Error) {
        return redact(detail.stack || detail.message || detail.name);
    }
    if (typeof detail === "string") return redact(detail);
    try {
        return redact(JSON.stringify(detail));
    } catch {
        return "[unserializable detail]";
    }
}

export class OsyCLogger {
    private readonly maxEntries: number;
    private readonly buffer: OsyCLogEntry[] = [];

    constructor(options: { maxEntries?: number } = {}) {
        this.maxEntries = Math.max(1, Math.floor(options.maxEntries ?? DEFAULT_MAX_ENTRIES));
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

    clear(): void {
        this.buffer.length = 0;
    }

    report(): string {
        const lines = this.buffer.map(
            (entry) => `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`
        );
        return ["OsyC diagnostic log", `entries=${this.buffer.length}`, ...lines].join("\n");
    }

    private push(level: OsyCLogLevel, message: string, detail?: unknown): void {
        const suffix = detail === undefined ? "" : ` | ${formatDetail(detail)}`;
        this.buffer.push({
            timestamp: new Date().toISOString(),
            level,
            message: redact(`${message}${suffix}`),
        });
        if (this.buffer.length > this.maxEntries) this.buffer.splice(0, this.buffer.length - this.maxEntries);
    }
}

export const osycLogger = new OsyCLogger();
