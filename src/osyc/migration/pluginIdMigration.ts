import { parseAIAgentPersisted, type AIAgentPersisted } from "@/osyc/serviceFeatures/aiAgentPersistence";
import { AGENT_CONFIG_PATH, CURRENT_PLUGIN_ID, LEGACY_PLUGIN_ID } from "./pluginIdentity";

export { AGENT_CONFIG_PATH, CURRENT_PLUGIN_ID, LEGACY_PLUGIN_ID } from "./pluginIdentity";

const PERSISTED_KEYS = new Set<keyof AIAgentPersisted>([
    "version",
    "apiBase",
    "token",
    "deviceId",
    "state",
    "tasks",
    "tripleTap",
    "showBall",
    "includeActiveNoteContext",
    "floatingPosition",
    "appearance",
    "fontResources",
]);

export type PluginIdMigrationAction = "none" | "migrate" | "block-legacy-enabled";

export interface PluginIdMigrationPlan {
    action: PluginIdMigrationAction;
    legacyDataPath: string;
    currentDataPath: string;
    agentConfigPath: string;
}

export function createPluginIdMigrationPlan(input: {
    legacyEnabled: boolean;
    legacyDataExists: boolean;
    currentDataExists: boolean;
}): PluginIdMigrationPlan {
    const legacyDataPath = `.obsidian/plugins/${LEGACY_PLUGIN_ID}/data.json`;
    const currentDataPath = `.obsidian/plugins/${CURRENT_PLUGIN_ID}/data.json`;
    if (input.legacyEnabled) {
        return { action: "block-legacy-enabled", legacyDataPath, currentDataPath, agentConfigPath: AGENT_CONFIG_PATH };
    }
    if (!input.currentDataExists && input.legacyDataExists) {
        return { action: "migrate", legacyDataPath, currentDataPath, agentConfigPath: AGENT_CONFIG_PATH };
    }
    return { action: "none", legacyDataPath, currentDataPath, agentConfigPath: AGENT_CONFIG_PATH };
}

export interface PersistedMigrationResult {
    ok: boolean;
    data: AIAgentPersisted;
    droppedKeys: string[];
}

export interface MigrationDataAdapter {
    exists(path: string): Promise<boolean>;
    read(path: string): Promise<string>;
    write(path: string, data: string): Promise<void>;
    mkdir?(path: string): Promise<void>;
}

export interface LegacyDataMigrationResult {
    action: PluginIdMigrationAction;
    legacyDataPath: string;
    currentDataPath: string;
    agentConfigPath: string;
    droppedKeys: string[];
}

/** Parse and sanitize legacy state without carrying LiveSync sync credentials. */
export function migratePersistedOsycData(raw: string): PersistedMigrationResult {
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        return { ok: false, data: { version: 1 }, droppedKeys: [] };
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return { ok: false, data: { version: 1 }, droppedKeys: [] };
    }
    const droppedKeys = Object.keys(value).filter((key) => !PERSISTED_KEYS.has(key as keyof AIAgentPersisted));
    return { ok: true, data: parseAIAgentPersisted(raw), droppedKeys };
}

/**
 * Copy legacy LiveSync core settings before the new plugin core starts.
 * The file is validated as JSON but otherwise kept opaque so sync settings are not lost.
 */
export async function migrateLegacyPluginData(
    adapter: MigrationDataAdapter,
    input: { legacyEnabled: boolean }
): Promise<LegacyDataMigrationResult> {
    const plan = createPluginIdMigrationPlan({
        legacyEnabled: input.legacyEnabled,
        legacyDataExists: await adapter.exists(`.obsidian/plugins/${LEGACY_PLUGIN_ID}/data.json`),
        currentDataExists: await adapter.exists(`.obsidian/plugins/${CURRENT_PLUGIN_ID}/data.json`),
    });
    const result: LegacyDataMigrationResult = { ...plan, droppedKeys: [] };
    if (plan.action !== "migrate") return result;

    const raw = await adapter.read(plan.legacyDataPath);
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error("Legacy OsyC configuration is not valid JSON");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("Legacy OsyC configuration has an invalid shape");
    }
    const currentDirectory = `.obsidian/plugins/${CURRENT_PLUGIN_ID}`;
    if (adapter.mkdir && !(await adapter.exists(currentDirectory))) {
        await adapter.mkdir(currentDirectory);
    }
    await adapter.write(plan.currentDataPath, raw);
    return result;
}

/** Build a safe path under the current plugin directory for a relative asset. */
export function pluginAssetPath(relativePath: string, sourceId: string = CURRENT_PLUGIN_ID): string | null {
    if (sourceId !== CURRENT_PLUGIN_ID && sourceId !== LEGACY_PLUGIN_ID) return null;
    const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!normalized || normalized.split("/").some((part) => part === ".." || part === "." || part === "")) return null;
    return `.obsidian/plugins/${CURRENT_PLUGIN_ID}/${normalized}`;
}

export function pluginCommandId(commandId: string, pluginId: string = CURRENT_PLUGIN_ID): string {
    const normalized = commandId.trim();
    if (!normalized || normalized.includes(":") || (pluginId !== CURRENT_PLUGIN_ID && pluginId !== LEGACY_PLUGIN_ID)) {
        throw new Error("Invalid plugin command id");
    }
    return `${CURRENT_PLUGIN_ID}:${normalized}`;
}
