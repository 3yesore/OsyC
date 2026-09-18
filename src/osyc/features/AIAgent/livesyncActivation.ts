/**
 * 激活自愈：保证「输入卡密后 vault 真的能上云」。
 *
 * ## 背景（2026-09-18 生产实测）
 *
 * 激活流程把后端下发的 setup URI 合并进 LiveSync 设置，但那段载荷**不含
 * `liveSync`**（只有身份类键 + `isConfigured`/`usePluginSyncV2`/`configPassphraseStore`/`encrypted*`），
 * 而 LiveSync 的默认值是 `false`。复制器的启动条件是
 * `liveSync || syncOnStart`（`ModuleReplicatorCouchDB._everyAfterResumeProcess`），
 * 两个都为 false 时它根本不会打开。
 *
 * 结果：激活 HTTP 200、设置也写进去了，**但一条笔记都不会上传** ——
 * 远端库只有 `obsydian_livesync_version`，服务端 vault 恒为空，AI 只能回答
 * 「没有找到任何笔记」。生产上 `3YESORE-CENTCOLYS` 的租户
 * `t_37e5e9d0…` 就是这个状态（doc_count = 1）。
 *
 * ## 为什么要做「启动时自愈」而不是只在激活时修
 *
 * 激活时修（{@link buildSetupPatch}）只能救**之后**的激活；已经被写坏的设备
 * （用户当前手机上那份配置）不会因为版本升级就自己好起来 ——
 * 除非用户重新输一次卡密。
 *
 * 这里在插件加载时做一次**受控**的自愈：只认「由 OsyC 激活流程配置过」的
 * 安装，且只在用户没有别的远端配置时动手。用户自己配的同步、或主动关掉
 * 同步的选择不会被覆盖。
 */

/** 激活流程写入的远端配置 id（见 setup URI 载荷与 `activeConfigurationId`）。 */
export const OSYC_REMOTE_CONFIG_ID = "osyc";

/** 自愈补丁：只开总开关，不碰任何身份类字段。 */
export interface ReplicationRepair {
    liveSync: true;
}

type SettingsShape = {
    isConfigured?: unknown;
    liveSync?: unknown;
    activeConfigurationId?: unknown;
    remoteConfigurations?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 判断是否需要补开同步开关。纯函数，方便单测。
 *
 * 返回补丁的条件（全部满足）：
 * 1. 这份配置已经完成过配置（`isConfigured === true`）—— 没配过的安装不动；
 * 2. 总开关当前不是打开状态 —— 已经是 true 就没什么可修；
 * 3. 存在由激活流程写入的 `osyc` 远端配置；
 * 4. 用户没有别的可用远端：当前激活的不是别的配置，且除 `osyc` 外没有其它配置。
 *
 * 第 4 条是安全阀：只要用户自己配过别的远端（或正用它），就**不**动。
 */
export function planProvisionedReplicationRepair(settings: SettingsShape | null | undefined): ReplicationRepair | null {
    if (!isRecord(settings)) return null;
    if (settings.isConfigured !== true) return null;
    if (settings.liveSync === true) return null;

    const remotes = settings.remoteConfigurations;
    if (!isRecord(remotes)) return null;
    const ids = Object.keys(remotes);
    if (!ids.includes(OSYC_REMOTE_CONFIG_ID)) return null;

    const others = ids.filter((id) => id !== OSYC_REMOTE_CONFIG_ID);
    const active = typeof settings.activeConfigurationId === "string" ? settings.activeConfigurationId : "";
    if (active && active !== OSYC_REMOTE_CONFIG_ID) return null;
    if (!active && others.length > 0) return null;

    return { liveSync: true };
}
