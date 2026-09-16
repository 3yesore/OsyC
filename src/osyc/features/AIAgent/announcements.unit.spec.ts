import { describe, expect, it } from "vitest";
import {
    AnnouncementClient,
    AnnouncementStore,
    type Announcement,
    parseAnnouncements,
} from "./announcements";

describe("OsyC announcements", () => {
    const announcement: Announcement = {
        id: "release-2.0.5",
        title: "OsyC 2.0.5",
        body: "稳定性更新",
        publishedAt: 1_700_000_000,
    };

    it("parses only safe announcement fields", () => {
        expect(parseAnnouncements([{ ...announcement, body: "x", secret: "drop" }, { id: 42 }])).toEqual([{ ...announcement, body: "x" }]);
    });

    it("caches announcements and tracks read IDs", () => {
        const storage = new Map<string, string>();
        const store = new AnnouncementStore(storage);
        store.save([announcement]);
        expect(store.load()).toEqual([announcement]);
        expect(store.unread([announcement])).toEqual([announcement]);
        store.markRead(announcement.id);
        expect(store.unread([announcement])).toEqual([]);
    });

    it("parses the backend items envelope and exposes unread announcements", async () => {
        const client = new AnnouncementClient({
            apiBase: "https://example.test",
            token: "token",
            storage: new Map<string, string>(),
            request: async () => ({ status: 200, json: { items: [announcement] } }),
        });
        await expect(client.refresh()).resolves.toEqual([announcement]);
        expect(client.unread()).toEqual([announcement]);
        client.markRead(announcement.id);
        expect(client.unread()).toEqual([]);
    });
});
