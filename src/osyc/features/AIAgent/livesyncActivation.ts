/**
 * 激活自愈：保证「输入卡密后 vault 真的能上云」。
 *
 * ## 背景（2026-09-18 生产实测）
 *
 * 激活流程把后端下发的 setup URI 合并进 LiveSync 设置，但那段载荷**不含
 * `liveSync`**，而 LiveSync 的默认值是 `false`。复制器的启动条件是
 * `liveSync || syncOnStart`（`ModuleReplicatorCouchDB._everyAfterResumeProcess`），
 * 两个都为 false 时它根本不会打开。
 *
 * 结果：激活 HTTP 200、设置也写进去了，**但一条笔记都不会上传** ——
 * 远端库只有 `obsydian_livesync_version`，服务端 vault 恒为空，AI 只能回答
 * 「没有找到任何笔记」。生产上 `3YESORE-CENTCOLYS` 的租户
 * `t_37e5e9d0…` 就是这个状态（doc_count = 1）。
 *
 * ## 为什么用「用户名前缀」判断是不是我们配置的
 *
 * setup URI 的载荷契约（commonlib 0.1.23 实测，见 `tools/verify_setup_uri.mjs`）
 * 只有 9 个键：`couchDB_URI` / `couchDB_USER` / `couchDB_PASSWORD` /
 * `couchDB_DBNAME` / `isConfigured` / `usePluginSyncV2` /
 * `configPassphraseStore` / `encryptedCouchDBConnection` / `encryptedPassphrase`。
 *
 * 也就是说客户端侧**拿不到** `remoteConfigurations` / `activeConfigurationId`
 * 之类的来源标记（那些是 CLI 自己生成的）。而 provisioner 给每个租户建的
 * CouchDB 账号固定叫 `osyc_sync_<32hex>` —— 这个前缀随载荷一起下发，
 * 是唯一可靠、且在客户端可直接读到的「这是 OsyC 配置的同步」凭据。
 *
 * ## 为什么只在启动时补
 *
 * 激活时补（`buildSetupPatch`）只救**之后**的激活；已经被写坏的设备不会因为
 * 版本升级自己好起来 —— 除非用户重输卡密。这里在插件加载时补一次，
 * 让已经激活过的设备下次启动就开始上传。
 */

/** provisioner 为每个租户创建的 CouchDB 同步账号前缀。 */
export const OSYC_SYNC_USER_PREFIX = "osyc_sync_";

/** 激活流程可能写入的远端配置 id（CLI 侧使用；插件侧载荷里没有）。 */
export const OSYC_REMOTE_CONFIG_ID = "osyc";

/** 自愈补丁：只开总开关，不碰任何身份类字段。 */
export interface ReplicationRepair {
    liveSync: true;
}

type SettingsShape = {
    isConfigured?: unknown;
    liveSync?: unknown;
    activeConfigurationId?: unknown;
    couchDB_USER?: unknown;
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
 * 3. `couchDB_USER` 是 OsyC provisioner 创建的 `osyc_sync_*` 账号
 *    —— 用户自己配的 CouchDB / 对象存储 / P2P 不会命中；
 * 4. 当前激活的不是别的远端配置。
 *
 * 第 3、4 条是安全阀：只修「由激活流程配置、且用户没有切到别的远端」的安装，
 * 不会覆盖用户自己的同步选择。
 */
export function planProvisionedReplicationRepair(settings: SettingsShape | null | undefined): ReplicationRepair | null {
    if (!isRecord(settings)) return null;
    if (settings.isConfigured !== true) return null;
    if (settings.liveSync === true) return null;

    const user = settings.couchDB_USER;
    if (typeof user !== "string") return null;
    if (!user.trim().toLowerCase().startsWith(OSYC_SYNC_USER_PREFIX)) return null;

    const active = typeof settings.activeConfigurationId === "string" ? settings.activeConfigurationId : "";
    if (active && active !== OSYC_REMOTE_CONFIG_ID) return null;

    return { liveSync: true };
}
