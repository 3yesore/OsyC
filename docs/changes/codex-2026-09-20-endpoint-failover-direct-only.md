# Change Record: 官方端点改为"只走灰云直连"，CF 域名彻底退出运行时候选

- **Agent**: 端点故障转移代理
- **Date**: `2026-09-20`
- **Branch**: `codex/endpoint-failover-2014`（源自 `release/2.0.14` @ `f8623f9` + cherry-pick `b3f8838`）
- **Related**: `src/osyc/features/AIAgent/serviceDefaults.ts`；工作区口径 `docs/reference/official-endpoints.md`（§2 链路清单 / §9 `永不写进插件默认值`）
- **Status**: `cherry-picked into release/2.0.14`

## Intent

让国内用户的 AI Agent 请求**只走灰云直连**，既快又稳定；Cloudflare 橙云隧道那条慢链路
（历史约 1.4 s/请求）不得再作为运行时可选路径。

## Root cause：一次建立在错误前提上的实现

前一笔实现 `b3f8838`（候选链 `api4 → osyctest → api`）的前提是
"**api4 与 osyctest 都是直连，api 是 CF**"。2026-09-20 复核证明这个前提是错的：

| 名字 | A 记录 | 响应头 | 判定 |
| --- | --- | --- | --- |
| `api4.sacu3.cn` | `106.55.1.124` | `Server: nginx/1.22.1` | ✅ 灰云直连 |
| `osyctest.sacu3.cn` | `172.67.192.54` / `104.21.65.204`（+ IPv6 `2606:4700::/32`） | `Server: cloudflare` + `CF-RAY` | ❌ Cloudflare 橙云 |
| `api.sacu3.cn` | 同上（同一组 CF IP） | `Server: cloudflare` + `CF-RAY` | ❌ Cloudflare 橙云 |

交叉验证：`223.5.5.5`（阿里）、`119.29.29.29`（DNSPod）、`1.1.1.1`、`8.8.8.8` 四个解析器结论一致；
`curl -w %{remote_ip}` 显示 `osyctest` 实际连到 `172.67.192.54`。
另外 `osyc3.sacu3.cn` 虽也是 `106.55.1.124` 直连，但它是 **CouchDB/同步**入口
（`/health` 也返回 401，`/api/*` 全部 401），**不是 API 后端**，不能当 API 回退。

## 实测（本机 Windows，2026-09-20 23:2x +08:00，各 20 次，串行）

原始命令（每个端点跑 20 次）：

```powershell
curl.exe -sS -o NUL --max-time 25 -w "%{http_code}|%{time_namelookup}|%{time_connect}|%{time_appconnect}|%{time_starttransfer}|%{time_total}" https://api4.sacu3.cn/health
curl.exe -sS -o NUL --max-time 25 -w "%{http_code}|%{time_namelookup}|%{time_connect}|%{time_appconnect}|%{time_starttransfer}|%{time_total}" https://osyctest.sacu3.cn/health
curl.exe -sS -o NUL --max-time 25 -w "%{http_code}|%{time_namelookup}|%{time_connect}|%{time_appconnect}|%{time_starttransfer}|%{time_total}" https://api.sacu3.cn/health
```

单位 ms；P95 取 nearest-rank（20 个样本 → 第 19 小）。失败 = curl 非 0 退出或 HTTP ≠ 200。

| 端点 | 失败 | DNS p50 / p95 | TLS 握手 p50 / p95 | TTFB p50 / p95 / max | 总耗时 p50 / p95 / max |
| --- | --- | --- | --- | --- | --- |
| `api4.sacu3.cn`（直连） | **0/20** | 25.0 / 113.6 | 205.6 / 324.5 | **288.1** / **550.3** / 1450.8 | **288.2** / **550.5** / 1451.0 |
| `osyctest.sacu3.cn`（CF） | 0/20 | 25.8 / 42.7 | 634.8 / 919.2 | 1529.6 / 3631.3 / 5363.4 | 1529.8 / 3631.4 / 5363.5 |
| `api.sacu3.cn`（CF） | 0/20 | 26.9 / 36.5 | 645.9 / 686.7 | 1498.0 / 3066.4 / 3518.5 | 1498.1 / 3066.6 / 3518.6 |

结论：
1. 直连 api4 的总耗时中位数 **288 ms**，两条 CF 链路约 **1.5 s** —— 直连快 **约 5.2 倍**，P95 差距更大（550 ms vs 3.6 s）。
2. 差距主要来自 **TLS 握手**（205 ms vs 635 ms）与 **TTFB**（288 ms vs 1529 ms）；DNS 三者相当。
3. 本机对 `sacu3.cn` 的 CF 请求落在 `CF-RAY ...-LHR`（伦敦边缘），这正是国内用户走 CF 变慢的原因。
4. 三个端点 20/20 都成功（样本时段内无硬失败），所以"稳定性"主要体现为**尾延迟**：
   api4 P95 550 ms，osyctest P95 3.6 s、单次最高 5.4 s。

## Final candidate chain（改造后）

```
候选链 = ["https://api4.sacu3.cn"]        // 唯一官方直连入口
DIRECT_FALLBACK_SERVICE_URLS = []          // 直连备用扩展点，当前为空；CF 地址永远不准进
LEGACY_OFFICIAL_SERVICE_URLS = ["https://api.sacu3.cn", "https://osyctest.sacu3.cn"]  // 只迁移到 api4
```

- 自动回退：没有第二条直连候选，因此不会回退到任何 CF 地址；
- 显式选择：用户填 `api` / `osyctest`（或历史持久化值）一律迁移到 `api4`，运行时不存在 CF 路径；
- 自填地址（自助部署）：仍只用自己的地址，不会被官方地址替换；
- 故障转移机制保留（`CmdAIAgent.apiRequest` + `serviceFailover.shouldTryNextEndpoint` /
  `tryEndpointsInOrder`），将来加入第二条**直连**入口时自动生效。

## Files changed

- `src/osyc/features/AIAgent/serviceDefaults.ts`：候选链收敛为直连 only；新增
  `DIRECT_FALLBACK_SERVICE_URLS`、`isOfficialServiceUrl`；`api` / `osyctest` 进 LEGACY；
  注释写明这次"把 CF 域名误当直连"的教训。
- `src/osyc/features/AIAgent/serviceFailover.ts`：新增 `tryEndpointsInOrder`（顺序回退 + 成功后短路）。
- `src/osyc/features/AIAgent/CmdAIAgent.ts`：`apiRequest` 改为调用 `tryEndpointsInOrder`，
  只在命中官方**直连**入口时才写回 `settings.apiBase`。
- `src/osyc/features/AIAgent/osycSettingsPane.ts`：设置页说明改为"只走直连、不使用 Cloudflare"。
- `serviceDefaults.unit.spec.ts` / `serviceFailover.unit.spec.ts` / `CmdAIAgent.unit.spec.ts`：重写候选链与回退用例。

## Known gaps

- 当前**没有**第二条直连 API 入口，所以"回退"在生产路径上不会发生（单测用合成候选列表覆盖机制）。
  要获得真正的直连冗余，需要在服务端加第二个直连入口（不同 IP / 线路）并进 `DIRECT_FALLBACK_SERVICE_URLS`。
- 移动网络/长连接场景（SSE 流式）未在本机 curl 实测覆盖；本表是单次 GET 的冷连接数据。
- `api.sacu3.cn` 与 `osyctest.sacu3.cn` 的 CF 隧道仍受控保留在服务端（工作区口径 §6），
  但**插件运行时不再引用**。

## Verification

`npx tsc --noEmit --skipLibCheck` 0 error；`npx vitest run --config vitest.config.unit.ts` 全绿（见提交/回报）。
