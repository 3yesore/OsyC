export interface Announcement {
    id: string;
    title: string;
    body: string;
    publishedAt: number;
    updatedAt?: number;
    level?: "info" | "success" | "warning" | "critical";
    url?: string;
}

const CACHE_KEY = "osyc:announcements:v1";
const READ_KEY = "osyc:announcements:read:v1";

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseAnnouncements(value: unknown): Announcement[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
        if (!record(item) || typeof item.id !== "string" || typeof item.title !== "string" || typeof item.body !== "string") return [];
        const publishedAt = typeof item.publishedAt === "number" ? item.publishedAt : typeof item.published_at === "number" ? item.published_at : typeof item.updated_at === "number" ? item.updated_at : NaN;
        if (!Number.isFinite(publishedAt)) return [];
        const announcement: Announcement = {
            id: item.id.trim(), title: item.title.trim(), body: item.body.trim(), publishedAt,
        };
        if (typeof item.updated_at === "number") announcement.updatedAt = item.updated_at;
        if (item.level === "info" || item.level === "success" || item.level === "warning" || item.level === "critical") announcement.level = item.level;
        if (!announcement.id || !announcement.title) return [];
        if (typeof item.url === "string" && /^https?:\/\//i.test(item.url)) announcement.url = item.url;
        return [announcement];
    });
}

export interface AnnouncementStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

export class AnnouncementStore {
    constructor(private readonly storage: AnnouncementStorage | Map<string, string>) {}

    load(): Announcement[] {
        const raw = this.get(CACHE_KEY);
        if (!raw) return [];
        try { return parseAnnouncements(JSON.parse(raw)); } catch { return []; }
    }

    save(items: Announcement[]): void { this.set(CACHE_KEY, JSON.stringify(parseAnnouncements(items))); }

    markRead(id: string): void {
        const ids = this.readIds(); ids.add(id); this.set(READ_KEY, JSON.stringify([...ids]));
    }

    unread(items: Announcement[] = this.load()): Announcement[] {
        const ids = this.readIds();
        return items.filter((item) => !ids.has(item.id));
    }

    private readIds(): Set<string> {
        const raw = this.get(READ_KEY);
        if (!raw) return new Set();
        try {
            const values = JSON.parse(raw);
            return new Set(Array.isArray(values) ? values.filter((value): value is string => typeof value === "string") : []);
        } catch { return new Set(); }
    }

    private get(key: string): string | null { return this.storage instanceof Map ? this.storage.get(key) ?? null : this.storage.getItem(key); }
    private set(key: string, value: string): void { this.storage instanceof Map ? this.storage.set(key, value) : this.storage.setItem(key, value); }
}

export interface AnnouncementClientOptions {
    apiBase: string;
    token: string;
    storage?: AnnouncementStorage | Map<string, string>;
    request?: (options: { url: string; method: string; headers?: Record<string, string>; throw?: boolean }) => Promise<{ status: number; json: unknown | (() => Promise<unknown>) }>;
}

export class AnnouncementClient {
    readonly store: AnnouncementStore;
    constructor(private readonly options: AnnouncementClientOptions) {
        const storage = options.storage ?? (typeof localStorage !== "undefined" ? localStorage : new Map<string, string>());
        this.store = new AnnouncementStore(storage);
    }

    cached(): Announcement[] { return this.store.load(); }
    unread(): Announcement[] { return this.store.unread(this.store.load()); }
    markRead(id: string): void { this.store.markRead(id); }

    configure(apiBase: string, token: string): void {
        this.options.apiBase = apiBase;
        this.options.token = token;
    }

    async refresh(): Promise<Announcement[]> {
        if (!this.options.apiBase) return this.cached();
        const request = this.options.request ?? (globalThis as unknown as { requestUrl?: AnnouncementClientOptions["request"] }).requestUrl;
        if (!request) return this.cached();
        const response = await request({
            url: `${this.options.apiBase.replace(/\/+$/, "")}/api/announcements`, method: "GET",
            headers: { Authorization: `Bearer ${this.options.token}` }, throw: false,
        });
        if (response.status >= 400) return this.cached();
        let data: unknown;
        try { data = typeof response.json === "function" ? await response.json() : await response.json; } catch { return this.cached(); }
        const envelope = record(data) && Array.isArray(data.items) ? data.items : data;
        const items = parseAnnouncements(envelope);
        this.store.save(items);
        return this.store.unread(items);
    }
}
