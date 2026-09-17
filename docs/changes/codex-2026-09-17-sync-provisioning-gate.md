# Change Record: 同步首次激活不再谎报失败（provisioning 等待与状态透出）

- **Agent**: `codex`
- **Date**: `2026-09-17`
- **Branch**: `codex-2.0.6-stabilize`
- **Backend**: `osyc-backend-fix-20260916`（`app/api/routes.py`）
- **Version reservation**: `2.0.8`（与设置跳转 / 配色修复同批）
- **Status**: `plugin published as the OsyC 2.0.8 GitHub pre-release; backend change not yet deployed`

## Intent

修掉「新用户输入卡密后，激活成功、积分到账，**但同步没起来**，提示还是『配置失败，请手动设置』」。

## Root cause

后端的同步目标（CouchDB 库与账号）是**异步** provision 的：

```
POST /api/activate
  → db.enqueue_tenant_provisioning(...)        # 只是入队，不等待
  → 立即返回 setup_uri = ""，provisioning_status = "pending"
```

而插件只判类型：

```ts
// 旧代码
if (typeof data.setup_uri === "string" && this.applySetupUri) {
    this.syncConfigured = await this.applySetupUri(data.setup_uri, cardKey);
```

空串也是 `string` → 进入分支 → 拿空 URI 去 `decodeSettingsFromSetupURI` 必然失败 →
用户看到「同步配置失败，请手动设置」。真实情况是**等几十秒就好**。

而且没有第二条路：`setup_uri` 只在激活那一刻下发，`refreshSync()` 只做 handshake
（`/api/sync/handshake`，`CmdAIAgent.ts:948-958`）**不补发配置** → provisioner 晚到或失败，
该设备就**永久没有同步**，用户必须重新输入卡密。

## 方案（以及被否决的方案）

**被否决**：在 `GET /api/status` 里回传 `setup_uri`，让插件轮询取回。
后端有既有的安全设计并带测试锁住 —— `tests/test_flow.py:520`：

```python
status = client.get("/api/status", headers=auth).json()
assert "sync_state" in status
assert "setup_uri" not in status          # ← 明文约束
```

`/api/task/{id}` 同理（`:534`）。把同步凭据挂到**只靠 device token 认证**的读接口上会
扩大攻击面 —— token 本该只能消耗积分/取任务结果，不该顺带能拿到同步凭据。

**采用**：等 provisioner 的地方放在 `/api/activate` 自身。

因为 **`setup_uri` 的加密口令就是卡密，而卡密不落盘**（`aiAgentPersistence.ts:9-10`
只存 token），所以**激活请求是唯一能把 setup_uri 合法交给设备的窗口**。于是：

| 改动 | 文件 | 内容 |
|---|---|---|
| ① 后端同步等待 | `app/api/routes.py` | 新增 `_tenant_sync_ready()`、`_wait_for_tenant_sync_ready()` 与轮询间隔常量 `ACTIVATE_PROVISION_POLL_SECONDS`；`activate()` 在 `enqueue_tenant_provisioning()` 之后调用它，再据此填 `provisioning_status`。**等待预算来自新配置项 `settings.activate_provision_wait_seconds`（默认 0）**：`db.ensure_tenant_identity` 建 tenant 时把 `remote_type` 写成 `"pending"`（`app/db.py:1120`），所以默认打开等待会让测试环境（没有 provisioner）每个新卡空等满预算 —— 实测让 `tests/test_flow.py` 从 23 秒涨到 9 分钟未完。生产部署通过 `ACTIVATE_PROVISION_WAIT_SECONDS=45` 显式启用。`activate` 是同步 `def`，FastAPI 在线程池里跑，所以这里的 `time.sleep` 不阻塞事件循环 |
| ② 后端状态透出 | `app/api/routes.py` | `StatusResponse` 新增 `provisioning_status: Literal["pending","ready","degraded"] = "pending"`；`status()` 用 `db.get_tenant()` + `remote_type` 判定（口径与 `/api/activate` 一致）。**只加状态字符串，不加 `setup_uri`** |
| ③ 插件按状态分支 | `src/osyc/features/AIAgent/CmdAIAgent.ts` | 分开读 `provisioning_status` 与 `setup_uri`；`setup_uri` 非空才调 `applySetupUri`；为空且 `pending` 时提示「同步正在服务器配置中，请稍后重新激活卡密完成同步」 |

效果：首次激活时后端等最多 45 秒，provision 在这窗口内完成就**一次配好**；
超时则给用户一句**可执行**的话（重新激活即可，那时 provision 已完成），而不是谎报失败。

## Verification

- **插件**：`vitest run --config vitest.config.unit.ts src` —— 119 个文件通过（含 `CmdAIAgent` 46 条）；`npm run check` 全绿（tsc 0 错 / eslint 0 错 9 条既有警告 / svelte-check 0 错 0 警 / iOS 15 兼容通过）。
- **后端**：`pytest --ignore=tests/test_provisioning_queue.py` —— **416 条，0 失败 0 错误 3 跳过**；其中 `tests/test_flow.py` 24 条全过（`test_sync_state_is_exposed_without_leaking_setup_uri` 恢复绿）。
- **已知既有问题（非本次引入）**：`tests/test_provisioning_queue.py` 因
  `ImportError: cannot import name '_provision_livesync_runtime'` 收集失败，会中断整轮
  pytest 收集 —— 该函数在 `scripts/provisioning_worker.py` 已不存在。跑测试时需
  `--ignore=tests/test_provisioning_queue.py`，否则看不到真实结果。
- **未部署**：后端改动尚未上线，需走一次 release 部署（插件侧已向后兼容：后端不返回
  `provisioning_status` 时，插件不进入任何分支，不再误报失败）。
