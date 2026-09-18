/**
 * 官方服务地址（分发方预置）。
 *
 * ## 为什么需要这个文件
 *
 * 插件里 `apiBase` 的历史默认值是**空串**，设计意图是"由分发方预置"，设置页只放了个
 * 占位符 `https://api.example.com`。但发布到社区目录的包里没有任何人预置它 ——
 * 新用户装完插件、粘贴卡密，客户端因为**没有地址可调用**而直接激活失败。
 * （实测：`CmdAIAgent.settings.apiBase` 为空时 `hasApiBase` 为 false，
 * `/api/activate` 根本发不出去。）
 *
 * 所以这里给出官方地址作为默认值，并且把历史上用过的官方地址迁移过来：
 * 设置页仍可覆盖（自助部署 / 联调），但"装完就能用"不再依赖用户手输。
 */

/** 官方后端入口：灰云直连 osyc-prod（2026-09-18 起取代 CF 隧道那条慢链路）。 */
export const DEFAULT_SERVICE_URL = "https://api4.sacu3.cn";

/**
 * 曾经作为官方分发地址使用过的入口。命中这里的历史值会被迁移到
 * {@link DEFAULT_SERVICE_URL}；用户自己填的其它地址一律不动。
 *
 * - `https://api.sacu3.cn`：走 Cloudflare 隧道 → osyc-prod:8124，实测 1.4s/请求（保留作备用）
 * - `https://osyctest.sacu3.cn`：更早的测试入口
 */
export const LEGACY_OFFICIAL_SERVICE_URLS: readonly string[] = [
    "https://api.sacu3.cn",
    "https://osyctest.sacu3.cn",
];

/** 去掉尾部斜杠后再比较，避免 `https://x/` 与 `https://x` 被当成两个地址。 */
function normalize(value: string): string {
    return value.trim().replace(/\/+$/, "");
}

/**
 * 决定实际要用的服务地址。
 *
 * 空值 → 官方默认；历史官方地址 → 迁移到官方默认；其它值 → 原样尊重（自助部署）。
 */
export function resolveServiceUrl(stored: string | null | undefined): string {
    const value = normalize(stored ?? "");
    if (value === "") return DEFAULT_SERVICE_URL;
    if (LEGACY_OFFICIAL_SERVICE_URLS.some((legacy) => normalize(legacy) === value)) {
        return DEFAULT_SERVICE_URL;
    }
    return value;
}
