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

    it("标记已读后列表仍返回该公告（已读不消失），只有未读数归零", async () => {
        const client = new AnnouncementClient({
            apiBase: "https://example.test",
            token: "token",
            storage: new Map<string, string>(),
            request: async () => ({ status: 200, json: { items: [announcement] } }),
        });
        await expect(client.refresh()).resolves.toEqual([announcement]);
        client.markRead(announcement.id);
        // 回归：此前 refresh() 返回的是 unread()，标记已读后公告会从弹窗里消失。
        await expect(client.refresh()).resolves.toEqual([announcement]);
        expect(client.cached()).toEqual([announcement]);
        expect(client.unread()).toEqual([]);
    });
});
