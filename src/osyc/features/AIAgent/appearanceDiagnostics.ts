export interface AppearanceDiagnosticsInput {
    pluginVersion: string;
    obsidianVersion: string;
    platform: string;
    viewport: { width: number; height: number };
    theme: string;
    appearanceVersion: number;
    backgroundEnabled: boolean;
    backgroundType: "image" | "solid" | "theme";
    backgroundExists: boolean;
    safeArea: { top: number; right: number; bottom: number; left: number };
    overflow: { taskList: boolean; composer: boolean };
    lastErrorCode?: number | null;
    /** Sensitive fields are accepted only so callers can pass a complete runtime snapshot. */
    cardKey?: unknown;
    token?: unknown;
    vaultPath?: unknown;
    noteBody?: unknown;
}

/** Build a deterministic, intentionally small diagnostic payload. Never include runtime secrets. */
export function buildAppearanceDiagnostics(input: AppearanceDiagnosticsInput): string {
    return JSON.stringify({
        pluginVersion: input.pluginVersion,
        obsidianVersion: input.obsidianVersion,
        platform: input.platform,
        viewport: input.viewport,
        theme: input.theme,
        appearanceVersion: input.appearanceVersion,
        background: {
            enabled: input.backgroundEnabled,
            type: input.backgroundType,
            exists: input.backgroundExists,
        },
        safeArea: input.safeArea,
        overflow: input.overflow,
        errorCode: input.lastErrorCode ?? null,
    });
}
