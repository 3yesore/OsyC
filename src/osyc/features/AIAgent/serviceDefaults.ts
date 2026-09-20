/**
 * 官方服务地址（分发方预置）+ 端点故障转移的候选顺序。
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
 *
 * ## 候选顺序（2026-09-20 定案：**只走灰云直连，不走 Cloudflare**）
 *
 * 口径见工作区 `docs/reference/official-endpoints.md` 与本仓
 * `docs/changes/codex-2026-09-20-endpoint-failover-direct-only.md`。
 *
 * - `api4.sacu3.cn`（灰云直连 106.55.1.124 → 127.0.0.1:8124）：**唯一正式入口**；
 * - `osyctest.sacu3.cn`、`api.sacu3.cn`：**都是 Cloudflare 橙云隧道**
 *   （A 记录 104.21.65.204 / 172.67.192.54，响应头 `Server: cloudflare`）。
 *
 * 2026-09-20 的一次实现（commit b3f8838）把这两条当成"直连备用"排进了候选链，前提有误：
 * 它们解析到的是同一组 Cloudflare 边缘 IP，本机 20 次实测 TTFB 中位数约 1.4 s，
 * 而 api4 约 0.28 s。按"不走 Cloudflare、保证国内直连速度与稳定"的决策，
 * 两者**都不再进入任何运行时候选**：既不自动回退，显式填写也会被迁移到 api4。
 *
 * 因此当前候选链**只有 api4 一个直连端点**。故障转移机制
 * （`CmdAIAgent.apiRequest` + `serviceFailover.ts`）保留：将来若出现第二条
 * "灰云直连、且与 api4 打同一个后端"的入口，加进 {@link DIRECT_FALLBACK_SERVICE_URLS}
 * 即可自动生效，不会引入 Cloudflare。
 */

/** 官方后端入口：灰云直连 osyc-prod（2026-09-18 起取代 CF 隧道那条慢链路）。 */
export const DEFAULT_SERVICE_URL = "https://api4.sacu3.cn";

/**
 * 直连备用入口，顺序即优先级。**目前为空**（2026-09-20 复核）。
 *
 * 准入条件（两条都满足才允许加入）：
 * 1. 必须是灰云直连（A 记录指向 106.55.1.124），不能是 Cloudflare 橙云 / 隧道；
 * 2. `/api/runtime-info` 的 `plugin_compatibility` 与 `backend_release_id`
 *    必须与 api4 完全一致（防"名字撞车、静默打到另一套系统"）。
 *
 * `osyctest.sacu3.cn` 曾短暂列在这里，但它实际是 Cloudflare 橙云隧道 —— 已移除。
 */
export const DIRECT_FALLBACK_SERVICE_URLS: readonly string[] = [];

/** 全部官方入口，顺序即优先级（第一条是默认值）。当前只有直连的 api4。 */
export const OFFICIAL_SERVICE_URLS: readonly string[] = [DEFAULT_SERVICE_URL, ...DIRECT_FALLBACK_SERVICE_URLS];

/**
 * 曾经作为官方分发地址使用过、且**已被取代**的入口：命中这里的历史值会被迁移到
 * {@link DEFAULT_SERVICE_URL}。
 *
 * - `https://api.sacu3.cn`：最早的官方入口，Cloudflare 橙云隧道；
 * - `https://osyctest.sacu3.cn`：更早的测试入口，同样是 Cloudflare 橙云隧道
 *   （2026-09-20 复核：A 记录 104.21.65.204 / 172.67.192.54，`Server: cloudflare`）。
 *
 * 两者都不是直连，所以不走进候选链、显式选择也会被迁移 —— 见文件头。
 */
export const LEGACY_OFFICIAL_SERVICE_URLS: readonly string[] = [
    "https://api.sacu3.cn",
    "https://osyctest.sacu3.cn",
];

/** 去掉尾部斜杠后再比较，避免 `https://x/` 与 `https://x` 被当成两个地址。 */
function normalize(value: string): string {
    return value.trim().replace(/\/+$/, "");
}

/** 是否是本文件登记的官方**直连**入口（写回 settings 前的白名单校验）。 */
export function isOfficialServiceUrl(value: string | null | undefined): boolean {
    const normalized = normalize(value ?? "");
    return normalized !== "" && OFFICIAL_SERVICE_URLS.some((official) => normalize(official) === normalized);
}

/**
 * 决定请求要按什么顺序尝试哪些端点。
 *
 * - 空值 → 官方候选全序列（当前只有直连的 api4）；
 * - 历史官方地址（api / osyctest，都是 Cloudflare）→ 官方候选全序列（迁移到 api4，不走 CF）；
 * - 官方直连地址 → 该地址优先，其余官方直连地址（当前没有）作为后备；
 * - 自填地址（自助部署 / 联调）→ **只用它**，不会被任何官方地址替换。
 */
export function resolveServiceCandidates(stored: string | null | undefined): string[] {
    const value = normalize(stored ?? "");
    if (value === "") return [...OFFICIAL_SERVICE_URLS];
    if (LEGACY_OFFICIAL_SERVICE_URLS.some((legacy) => normalize(legacy) === value)) {
        return [...OFFICIAL_SERVICE_URLS];
    }
    if (isOfficialServiceUrl(value)) {
        return [value, ...OFFICIAL_SERVICE_URLS.filter((official) => normalize(official) !== value)];
    }
    return [value];
}

/**
 * 决定实际要用的**首选**服务地址（等价于候选序列的第一条）。
 *
 * 空值 → 官方默认；历史官方地址 → 迁移到官方默认；其它值 → 原样尊重（自助部署）。
 */
export function resolveServiceUrl(stored: string | null | undefined): string {
    return resolveServiceCandidates(stored)[0];
}
