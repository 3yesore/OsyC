/** Canonical OsyC plugin identity. Keep the display name separate from the ID. */
export const CURRENT_PLUGIN_ID = "osyc";
export const LEGACY_PLUGIN_ID = "obsidian-livesync";
/** Normalise Obsidian's configurable Vault configuration directory. */
export function normaliseConfigDir(configDir: string): string {
    const normalised = configDir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (!normalised || normalised.split("/").some((part) => part === "" || part === "." || part === "..")) {
        throw new Error("Invalid Obsidian configuration directory");
    }
    return normalised;
}

export function agentConfigPath(configDir: string): string {
    return `${normaliseConfigDir(configDir)}/livesync-aiagent.json`;
}
