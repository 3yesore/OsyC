import type { App } from "@/deps.ts";

/** Root element of Obsidian's settings modal; used only as a visibility probe. */
const SETTINGS_HOST_SELECTOR = ".mod-settings";

function getSettingsManager(app: App): Record<string, unknown> {
    const manager: unknown = Reflect.get(app, "setting");
    if (typeof manager !== "object" || manager === null) {
        throw new TypeError("Obsidian does not expose the settings manager");
    }
    return manager as Record<string, unknown>;
}

function invokeSettingsMethod(app: App, methodName: string, args: unknown[] = []): void {
    const manager = getSettingsManager(app);
    const method = manager[methodName];
    if (typeof method !== "function") {
        throw new TypeError(`Obsidian does not expose settings.${methodName}`);
    }
    Reflect.apply(method, manager, args);
}

/**
 * Open Obsidian's settings window **on the given tab, directly**.
 *
 * Obsidian's `openTabById` already opens the window, so calling `open()`
 * first (what this used to do) painted whichever tab was active last
 * time — that extra frame is the "it jumps to Obsidian's own settings
 * first" flicker. It also swallowed bad tab ids: a tab that does not
 * exist left the window parked on that previously active native page,
 * which is how the old `"synchronisation"` call site (a LiveSync settings
 * *group*, not an Obsidian tab) quietly landed users on native settings.
 *
 * Group ids are deliberately not accepted here: LiveSync declares its root
 * groups through `getSettingDefinitions()` without an id, so there is
 * nothing for `openTabById` to match against.
 */
export function openObsidianSettings(app: App, tabId: string): void {
    const manager = getSettingsManager(app);
    const openTabById = manager["openTabById"];
    if (typeof openTabById !== "function") {
        // Builds without the tab-aware opener can only show the settings root.
        invokeSettingsMethod(app, "open");
        return;
    }
    const activateTargetTab = () => Reflect.apply(openTabById, manager, [tabId]);
    activateTargetTab();
    // Defensive: if this build treats openTabById as a pure tab switch while
    // the window is closed, open it once. Never re-open a window that is
    // already visible — that is exactly the flicker this function removes.
    queueMicrotask(() => {
        if (typeof document === "undefined") return;
        if (document.querySelector(SETTINGS_HOST_SELECTOR)) return;
        try {
            invokeSettingsMethod(app, "open");
            activateTargetTab();
        } catch (error) {
            console.error("未能打开 Obsidian 设置", error);
        }
    });
}

export function closeObsidianSettings(app: App): void {
    invokeSettingsMethod(app, "close");
}
