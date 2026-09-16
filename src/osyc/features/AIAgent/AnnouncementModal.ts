import { Modal, Notice, Setting, type App } from "@/deps.ts";
import { get, type Writable } from "svelte/store";
import type { Announcement } from "./announcements";

/** Native Obsidian dialogue for the account announcement feed. */
export class AnnouncementModal extends Modal {
    private unsubscribe?: () => void;

    constructor(
        app: App,
        private readonly announcements: Writable<Announcement[]>,
        private readonly refreshAnnouncements: () => Promise<void>,
        private readonly markRead: (id: string) => void,
    ) {
        super(app);
    }

    override onOpen(): void {
        this.modalEl.addClass("osyc-announcement-modal");
        this.unsubscribe = this.announcements.subscribe(() => this.render());
        void this.refreshAnnouncements().catch(() => new Notice("公告刷新失败，已显示本地缓存。"));
    }

    override onClose(): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        this.contentEl.empty();
        this.modalEl.removeClass("osyc-announcement-modal");
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "公告" });
        new Setting(contentEl)
            .setName("服务公告")
            .setDesc("公告按账户权益显示，网络不可用时保留本地缓存。")
            .addButton((button) => button.setButtonText("刷新").onClick(async () => {
                button.setDisabled(true);
                try {
                    await this.refreshAnnouncements();
                    new Notice("公告已刷新。");
                } catch {
                    new Notice("公告刷新失败，已显示本地缓存。");
                } finally {
                    button.setDisabled(false);
                }
            }));

        const items = get(this.announcements);
        if (items.length === 0) {
            contentEl.createEl("p", { text: "暂无公告", cls: "setting-item-description" });
            return;
        }
        for (const item of items) {
            const setting = new Setting(contentEl)
                .setName(item.title)
                .setDesc(`${new Date((item.publishedAt ?? item.updatedAt ?? 0) * 1000).toLocaleString("zh-CN")}\n${item.body}`);
            if (item.level === "critical") setting.setClass("osyc-announcement-critical");
            setting.addButton((button) => button.setButtonText("标记已读").onClick(() => {
                this.markRead(item.id);
                new Notice("已标记为已读。");
            }));
        }
    }
}
