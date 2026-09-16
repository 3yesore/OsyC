import type { AppearanceSettings } from "@/osyc/features/AIAgent/appearance";
import type { FontResource } from "@/osyc/theme/fontResources";

/** 一次性读取的 OsyC 偏好快照，仅用于渲染设置页。 */
export type OsycSettingsSnapshot = {
    serviceUrl: string;
    tripleTap: boolean;
    showBall: boolean;
    includeActiveNoteContext: boolean;
    appearance: AppearanceSettings;
    fontResources: readonly FontResource[];
};

/**
 * OsyC 设置页与运行时状态之间的桥。
 *
 * 设置页本身不持有任何偏好，只负责渲染官方 Setting 组件；真正的读写留在
 * `useAIAgentUI` 的闭包里，避免出现第二份状态而互相覆盖。
 */
export type OsycSettingsController = {
    snapshot: () => OsycSettingsSnapshot;
    vaultImages: () => string[];
    vaultFonts: () => string[];
    setServiceUrl: (value: string) => void;
    setTripleTap: (value: boolean) => void;
    setShowBall: (value: boolean) => void;
    /** 返回 false 表示该偏好被拒绝，调用方应把开关还原。 */
    setIncludeActiveNoteContext: (value: boolean) => Promise<boolean>;
    setAppearance: (next: AppearanceSettings) => void;
    resetAppearance: () => void;
    importFont: (path: string) => Promise<FontResource | null>;
    /** 把 Vault 内图片路径解析成可用的资源 URL；失败时返回空串。 */
    resolveResourceUrl: (vaultPath: string) => string;
    openLog: () => void;
    copyDiagnostics: () => Promise<void>;
    pluginVersion: () => string;
};

let controller: OsycSettingsController | null = null;

/** 由 `useAIAgentUI` 在服务装配时注册；卸载时传 null。 */
export function setOsycSettingsController(next: OsycSettingsController | null): void {
    controller = next;
}

export function getOsycSettingsController(): OsycSettingsController | null {
    return controller;
}
