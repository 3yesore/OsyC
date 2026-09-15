import { describe, expect, it } from "vitest";
import {
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
});
