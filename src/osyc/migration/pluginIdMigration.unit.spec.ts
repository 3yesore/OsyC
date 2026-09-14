import { describe, expect, it } from "vitest";
import {
    CURRENT_PLUGIN_ID,
    LEGACY_PLUGIN_ID,
    createPluginIdMigrationPlan,
    migratePersistedOsycData,
    pluginAssetPath,
    pluginCommandId,
} from "./pluginIdMigration";

describe("OsyC plugin ID migration", () => {
    it("uses a lower-case canonical ID while keeping the OsyC display name independent", () => {
        expect(CURRENT_PLUGIN_ID).toBe("osyc");
        expect(LEGACY_PLUGIN_ID).toBe("obsidian-livesync");
    });

    it("blocks startup when the legacy sync plugin is still enabled", () => {
        expect(createPluginIdMigrationPlan({ configDir: ".obsidian", legacyEnabled: true, legacyDataExists: true, currentDataExists: false })).toMatchObject({
            action: "block-legacy-enabled",
            legacyDataPath: ".obsidian/plugins/obsidian-livesync/data.json",
            currentDataPath: ".obsidian/plugins/osyc/data.json",
            agentConfigPath: ".obsidian/livesync-aiagent.json",
        });
        expect(createPluginIdMigrationPlan({ configDir: ".obsidian", legacyEnabled: true, legacyDataExists: false, currentDataExists: true }).action).toBe("block-legacy-enabled");
    });

    it("requests a migration only when legacy data exists and the new data is absent", () => {
        expect(createPluginIdMigrationPlan({ configDir: ".obsidian", legacyEnabled: false, legacyDataExists: true, currentDataExists: false }).action).toBe("migrate");
        expect(createPluginIdMigrationPlan({ configDir: ".obsidian", legacyEnabled: false, legacyDataExists: true, currentDataExists: true }).action).toBe("none");
        expect(createPluginIdMigrationPlan({ configDir: ".obsidian", legacyEnabled: false, legacyDataExists: false, currentDataExists: false }).action).toBe("none");
    });

    it("uses the host vault config directory for migration paths", () => {
        expect(createPluginIdMigrationPlan({
            configDir: ".settings",
            legacyEnabled: false,
            legacyDataExists: true,
            currentDataExists: false,
        })).toMatchObject({
            legacyDataPath: ".settings/plugins/obsidian-livesync/data.json",
            currentDataPath: ".settings/plugins/osyc/data.json",
            agentConfigPath: ".settings/livesync-aiagent.json",
        });
    });

    it("keeps only validated OsyC state and drops unknown or sync credential fields", () => {
        const result = migratePersistedOsycData(JSON.stringify({
            version: 1,
            apiBase: "https://osyctest.sacu3.cn",
            token: "device-token",
            appearance: { fontSize: 18 },
            floatingPosition: { x: 0.5, y: 0.25 },
            couchDB_USER: "must-not-migrate",
            passphrase: "must-not-migrate",
            unknown: true,
        }));
        expect(result.ok).toBe(true);
        expect(result.data).toMatchObject({ apiBase: "https://osyctest.sacu3.cn", token: "device-token" });
        expect(result.data).not.toHaveProperty("couchDB_USER");
        expect(result.data).not.toHaveProperty("passphrase");
        expect(result.droppedKeys).toEqual(expect.arrayContaining(["couchDB_USER", "passphrase", "unknown"]));
    });

    it("rewrites only plugin-owned asset and command paths", () => {
        expect(pluginAssetPath("fonts/demo.woff2", LEGACY_PLUGIN_ID)).toBe(".obsidian/plugins/osyc/fonts/demo.woff2");
        expect(pluginAssetPath("fonts/demo.woff2", CURRENT_PLUGIN_ID)).toBe(".obsidian/plugins/osyc/fonts/demo.woff2");
        expect(pluginAssetPath("../data.json", LEGACY_PLUGIN_ID)).toBeNull();
        expect(pluginCommandId("dump-debug-info", CURRENT_PLUGIN_ID)).toBe("osyc:dump-debug-info");
        expect(pluginCommandId("dump-debug-info", LEGACY_PLUGIN_ID)).toBe("osyc:dump-debug-info");
    });

    it("creates the new plugin directory before copying valid legacy LiveSync settings", async () => {
        const files = new Map<string, string>([[".obsidian/plugins/obsidian-livesync/data.json", '{"couchDB_URI":"https://sync.example"}']]);
        const directories: string[] = [];
        const adapter = {
            exists: async (path: string) => files.has(path),
            read: async (path: string) => files.get(path) ?? "",
            write: async (path: string, value: string) => void files.set(path, value),
            mkdir: async (path: string) => void directories.push(path),
        };
        const { migrateLegacyPluginData } = await import("./pluginIdMigration");
        const result = await migrateLegacyPluginData(adapter, { configDir: ".obsidian", legacyEnabled: false });
        expect(result.action).toBe("migrate");
        expect(directories).toContain(".obsidian/plugins/osyc");
        expect(files.get(".obsidian/plugins/osyc/data.json")).toBe('{"couchDB_URI":"https://sync.example"}');
    });

    it("does not write or create a directory when legacy JSON is malformed", async () => {
        const writes: string[] = [];
        const directories: string[] = [];
        const adapter = {
            exists: async (path: string) => path === ".obsidian/plugins/obsidian-livesync/data.json",
            read: async () => "{broken",
            write: async (path: string) => void writes.push(path),
            mkdir: async (path: string) => void directories.push(path),
        };
        const { migrateLegacyPluginData } = await import("./pluginIdMigration");
        await expect(migrateLegacyPluginData(adapter, { configDir: ".obsidian", legacyEnabled: false })).rejects.toThrow("not valid JSON");
        expect(writes).toHaveLength(0);
        expect(directories).toHaveLength(0);
    });

    it("never copies legacy settings while the old plugin is enabled", async () => {
        const writes: string[] = [];
        const adapter = {
            exists: async (path: string) => path.includes("obsidian-livesync"),
            read: async () => "{}",
            write: async (path: string) => void writes.push(path),
        };
        const { migrateLegacyPluginData } = await import("./pluginIdMigration");
        const result = await migrateLegacyPluginData(adapter, { configDir: ".obsidian", legacyEnabled: true });
        expect(result.action).toBe("block-legacy-enabled");
        expect(writes).toHaveLength(0);
    });
});
