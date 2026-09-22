# OsyC 底座索引（Foundation Index）

> 目的：任何人（包括下一个 agent）拿到这一页就能找到发布、诊断、支付、邮箱、同步、哨兵的位置，不用问人。
> 维护：新增/移动脚本、文档或单元时，同步更新本页「最后更新」。
> 最后更新：2026-09-22。本页在父工作区与插件仓各一份，内容相同：
> `C:\Users\Y2516\osyc-workspace\docs\FOUNDATION-INDEX.zh.md` 与 `plugin/docs/FOUNDATION-INDEX.zh.md`。

## 0. 仓库、服务与入口

| 对象 | 位置 |
| --- | --- |
| 插件仓（本地 checkout） | `C:\Users\Y2516\osyc-workspace\plugin` —— 本地分支可能停在旧版本，**权威基线永远是 `origin/main`**（当前 2.0.17 = `391268c`） |
| 插件工作树 | `C:\Users\Y2516\osyc-workspace\worktrees\<name>`（`git worktree list`） |
| 父工作区 | `C:\Users\Y2516\osyc-workspace`（`ops/`、`docs/reference/`、`docs/inventory/`、`tools/`、`backend/`） |
| 后端源码仓 | `C:\Users\Y2516\osyc-workspace\backend`（历史由每个 release 一份 snapshot commit 重建；`main` = `origin/main`） |
| 生产服务器 | `ssh osyc-prod`；生产树 `/srv/osyc/current`（指向 `/srv/osyc/releases/<name>`）；venv `/srv/osyc/venv` |
| 运维脚本目录 | `/usr/local/lib/osyc/`（哨兵、safe_patch、发布/回滚辅助） |

## 1. 插件发布流程与门禁

- 切版收口清单：`plugin/docs/RELEASE-CLOSURE-CHECKLIST.zh.md` —— **切版前必须跑 `node scripts/gate-all.mjs`（或 `sh scripts/gate-all.sh`），六项全绿才继续**。
- 一键门禁：`node scripts/gate-all.mjs`（`--list` 只列项）。六项固定：`tsc --noEmit --skipLibCheck`、`lint`、`svelte-check`、`tsc-check:apps`、`test:unit -- --pool=threads`、`test:acceptance:sync:self-test`。任一项失败立即非零退出。
- 同步验收门禁：`npm run test:acceptance:sync` / `...:self-test`；说明见 `plugin/docs/osyc-sync-acceptance.zh.md`（默认链路 16 项、Pro 链路 19 项）。
- 发布治理与唯一权威：`plugin/docs/releases/README.md`、`plugin/docs/releases/release-ledger.json`。
- 发布由 push 到 `main` 触发 `.github/workflows/publish-release-assets.yml`；发布权归 `release-captain`。
- 契约校验：`node utils/verify-osyc-release.mjs`、`node utils/verify-osyc-collaboration.mjs`。
- 五个资产指纹：`release-info.json`（人工维护，无生成器）。

## 2. 后端发布台账与回滚

- 台账：`/srv/osyc/RELEASE-LEDGER.zh.md`（每次切换后更新）。
- 回滚脚本：`/srv/osyc/rollback/<release 短名>-rollback.sh`，说明与链见 `/srv/osyc/rollback/README.zh.md`。每个保留 release 一份；脚本做「原子改 `current` + 还原 `/etc/osyc/*.env.bak-before-<短名>`（无备份则改 `RUNTIME_RELEASE_ID`）+ 重启 `osyc-api` / `osyc-provisioner` + 自检」。
- 完整性：先定稿 `deploy/runtime-manifest.json` 与 `RUNTIME_RELEASE_ID`，再跑 `sh /usr/local/lib/osyc/finalize_release_integrity.sh [release]`，最后 `cd /srv/osyc/current && sha256sum -c SHA256SUMS`（应全 OK）。
- 切换前校验：`cd /srv/osyc/releases/<release> && set -a && . /etc/osyc/runtime.env && set +a && /srv/osyc/venv/bin/python validate_release.py`。
- 发布说明模板：`/srv/osyc/RELEASE-NOTES-TEMPLATE.zh.md`（固定检查项含「从含上一版全部功能的树切出 + 路由/端点数与基线差分」，对应 2026-09-21 Pro 路由被覆盖事故）。
- 回收：`/usr/local/lib/osyc/release_gc.sh`（默认 dry-run，`--apply` 删除；`current` 与在用 release 永不删）。
- 发布说明实例：各 release 根的 `RELEASE-NOTES.zh.md` 与 `RELEASE_<topic>.md`。

## 3. 诊断链路（report_id 全链路）

- 客户端上传入口：`plugin/src/osyc/features/AIAgent/diagnosticsUpload.ts` —— `buildErrorReportPayload()` / `uploadErrorReport()`，POST `/api/error-reports`；`request_id = <task_id>-<epoch_ms>`，同时作为 `Idempotency-Key`。
- 服务端端点：`/srv/osyc/current/app/api/routes.py` 的 `submit_error_report`（返回 `report_id = "err_" + secrets.token_urlsafe(12)`）；表与方法在 `app/db.py`（`error_reports`、`get_error_report_by_id` 等）。
- 大小写：report_id 区分大小写，但 2026-09-22 起按服务端只读路径统一用 `COLLATE NOCASE` 查询，抄错大小写也能读回。
- 只读读回（唯一入口，不另开 HTTP）：`cd /srv/osyc/current && /srv/osyc/venv/bin/python scripts/read_error_report.py err_XXX`；`--list 20` 只列索引。
- report_id → HTTP 请求/任务：见该脚本文档 —— `request_id` 去掉尾部 `-<epoch_ms>` 得 `task_id` → `tasks` 表；`created_at` 对齐 `/var/log/nginx/osyc-api4.access.log`；载荷 `api_failures[]` 给出 path+status。
- 加密密钥（只报名字，不读值）：环境变量 `ERROR_REPORT_ENCRYPTION_KEY`，在 `/etc/osyc/runtime.env`；经 `app/card_crypto/crypto.py` 做 AES-GCM。
- 卡片身份侧车（另一套）：`CARD_CRYPTO_MASTER_KEY` / `CARD_CRYPTO_SERVICE_KEY`，见 `/srv/osyc/current/deploy/CARD_CRYPTO.md`。

## 4. 支付订单核心与 CLI

- 核心：`/srv/osyc/current/app/recharge_orders.py`（渠道无关的「订单 + 积分」核心）；`app/payment/`（`base.py` / `epay.py` / `orders.py` / `products.py` / `routes.py`）。
- HTTP：`app/api/routes.py` 的 `/api/recharge`、`/api/orders`、`POST /api/orders/{order_id}/cancel`、渠道回调；`app/payment/routes.py`。
- 订单 CLI：`/srv/osyc/venv/bin/python -m scripts.recharge_order_cli order list|show|manual-fulfill|refund-mark ...`。
- 调度 CLI：`/usr/local/lib/osyc/osyc_schedule_cli.py list --tenant <UUID>`。
- Pro 空间 CLI：`/srv/osyc/venv/bin/python -m scripts.pro_namespace_cli status <卡密|UUID>`。
- 文档：`plugin/docs/PRO_SYNC_SPACE-LISTING.zh.md`；父工作区 `docs/reference/billing-and-entitlements.md`（价格与权益口径；文档中不写人民币↔积分映射）。

## 5. 邮箱身份契约

- 契约文档：`plugin/docs/EMAIL-IDENTITY-CONTRACT.zh.md` —— 4 个端点（`/api/email/send-code`、`/api/email/verify`、`/api/account/bind-email`、`/api/account/bind-card`）、状态码语义与 G1–G7 差距清单。
- 服务端实现：`/srv/osyc/current/app/email_auth.py`、`app/mailer.py`；测试 `tests/test_email_auth.py`、`tests/test_email_account_session.py`。

## 6. LiveSync 桥接与镜像

- 桥接哨兵：`/usr/local/lib/osyc/check_livesync_bridge.py`（动词白名单、`flock`、`preexec` 降权、无 `shell=True`、admin state/command 端点）。
- 桥接代码：`/srv/osyc/current/app/bridge/`（`client.py` / `service.py` / `cron_context.py`）；编排 `app/sync.py`、`app/livesync_runner.py`。
- 运行器与镜像：`/usr/local/lib/osyc/osyc-sync-runner`；租户配置 `/etc/osyc/livesync/tenants/<id>.json`；数据 `/var/lib/osyc/vaults`、`/var/lib/osyc/livesync`；CLI `/opt/osyc/livesync-cli-dd280a4/src/apps/cli/dist/index.cjs`；预热 `osyc-sync-warm.sh`。
- 插件补丁：`plugin/src/osyc/features/AIAgent/livesyncPatch.ts`、`livesyncActivation.ts`；决策 `plugin/docs/LIVESYNCPATCH-RECONCILIATION.zh.md`。
- 验收：`npm run test:acceptance:sync:self-test`（离线断言），真机链路另见收口清单第 4.2/4.3 节。

## 7. 哨兵（/usr/local/lib/osyc/）与定时器

- 编排入口：`osyc_health_report.py`（聚合下列哨兵 + `/health` + timer 状态，写 `/var/log/osyc/health.json` 与 `alerts.log`）。

| 哨兵 | 检查内容 |
| --- | --- |
| `check_cron_metering.py` | cron 计费链在跑，窗口内每次运行都真实扣费（无静默漏扣） |
| `check_data_backup.py` | 租户数据备份（vault 目录 + CouchDB 同步库）新鲜可读 |
| `check_data_planes.py` | 两个数据平面可达：R2（Cloud-Vault）与 CouchDB（LiveSync） |
| `check_db_backup.py` | 后端共享库备份新鲜（≤26h）且可校验 |
| `check_disk_space.py` | 根分区剩余空间阈值 |
| `check_endpoints.py` | 端点巡检：DNS / TLS / health / 兼容窗口 / 交叉链接身份一致性 |
| `check_hermes_*.py` | 网关补丁是否被升级冲掉（model-name / provider-raw / usage-cache / skills-external / platform-toolsets / gateway-patches） |
| `check_livesync_bridge.py` | LiveSync 受控动词桥接在位（见 §6） |
| `check_missing_usage.py` | 无未处理的计费缺口 |
| `check_osyc_timers.py` | 所有 OsyC timer 存在、enabled、active，且上次运行成功 |
| `check_pro_namespace_sweep.py` | Pro 7 天自动清理确实在跑 |
| `check_provider_balance.py` | 供应商余额与账本真实成本对账 |
| `check_provider_keys.py` / `_live.py` | 供应商密钥池卫生（只打印指纹） |
| `check_tls_cert.py` | 证书剩余有效期 |
| `check_usage_authority.py` | 真实成本对账 + 自动纠正 + 余额校准 |
| `check_unit_drift.sh` | 长驻单元运行的代码是否仍等于 `current`（未重启的单元跑旧代码） |

- 定时器单元（本地快照，以 host `systemctl` 为准）：`C:\Users\Y2516\osyc-workspace\ops\deploy\units\`。

## 8. 相关参考

- 父工作区：`docs/reference/`（env-keys、etc-osyc-env-backups、server-infrastructure、official-endpoints、billing-and-entitlements）、`docs/inventory/`、`docs/reports/`。
- 后端：`backend/docs/OPERATIONS-RUNBOOK.zh.md`、`backend/docs/LAUNCH-CHECKLIST.zh.md`、`backend/docs/entitlements-and-tiers.zh.md`、`backend/docs/HERMES-ACCEPTANCE-INDEX.zh.md`。
- 运维目录：`ops/runbook/`、`ops/deploy/`、`ops/endpoints/`、`ops/xianyu/`。
