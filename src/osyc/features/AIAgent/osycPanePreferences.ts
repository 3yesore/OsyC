import { requireApiVersion, type App } from "@/deps.ts";

/**
 * OsyC pane interface preferences.
 *
 * These describe how the pane looks on this device, not what the plugin syncs,
 * so they go through Obsidian's own per-vault local storage - the same channel
 * DocumentHistory uses. Writing them into the shared LiveSync settings object
 * would push one device's layout onto every other device.
 */
export const OSYC_PANE_PREFERENCE_KEYS = {
    sidebarCollapsed: "osyc-pane-sidebar-collapsed",
} as const;

export type OsycPanePreferenceKey = (typeof OSYC_PANE_PREFERENCE_KEYS)[keyof typeof OSYC_PANE_PREFERENCE_KEYS];

export function loadOsycPaneBooleanPreference(app: App, key: OsycPanePreferenceKey): boolean {
    if (requireApiVersion("1.8.7")) {
        return app.loadLocalStorage(key) === "1";
    }
    return false;
}

export function saveOsycPaneBooleanPreference(app: App, key: OsycPanePreferenceKey, enabled: boolean): void {
    if (requireApiVersion("1.8.7")) {
        app.saveLocalStorage(key, enabled ? "1" : null);
    }
}
