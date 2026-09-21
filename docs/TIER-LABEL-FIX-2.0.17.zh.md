# D6 修复：纯邮箱登录的 member / pro 档位标签回落「基础版」（2.0.17）

- **问题编号**：D6（买家可用性验收）
- **影响版本**：插件 `2.0.16` + 当时线上后端（`osyc-backend-20260921-email-pro-announce-merge-01` 之前）
- **修复版本**：插件分支 `codex/tier-label-2.0.17`（基线 `origin/main` = 2.0.16）+ 后端同 release 增量补丁
- **范围**：插件 + 服务端各一处；**未改任何档位权益数值**，未改 livesyncPatch / livesyncActivation / serviceDefaults 核心逻辑

---

## 1. 现象

用**邮箱验证码登录**（`POST /api/email/verify`）进来的 member / pro 买家，打开「我的账户」时档位标签显示为「基础版」，会员 / Pro 的权益区块（定时任务、Cloud-Vault 空间、设备数上限、专属技能）也按基础版渲染。

同一张卡密若走**卡密激活**（`POST /api/activate`）进入，则档位与权益显示正确 —— 也就是说，只有「邮箱登录」这条入口坏。

## 2. 根因

两条入口拿到档位信息的方式不同：

| 入口 | 档位 / 权益来源 | 修复前结果 |
| --- | --- | --- |
| 卡密激活 | `POST /api/activate` 的 `ActivateResponse`（`app/api/routes.py:77`）内含 `plan` + `entitlements` | 正确 |
| 邮箱验证码登录 | 只回 `token`；插件随后 `refreshStatus()` 调 `GET /api/status` | **该接口不返回 `plan` / `entitlements`** → `state.plan` 停在默认 `base` |

具体链路（基线 2.0.16）：

1. `app/api/routes.py:979` `status()` 只组装积分 / 有效期 / 模型 / 同步状态等字段（`StatusResponse`，`routes.py:117`），其中**没有** `plan` 字段；
2. `app/plans.py:157` `entitlements_for(plan, registry)` 是唯一的权益计算函数，但只有 `/api/activate`（`routes.py:499`）调用它；
3. 插件 `src/osyc/features/AIAgent/CmdAIAgent.ts:710` `loginWithEmail()` **已经**在拿到 `token` 后调用 `await this.refreshStatus()`（基线第 740 行），并不是「没调用」；
4. 但 `CmdAIAgent.ts:1592` `refreshStatus()` 只解析积分 / 有效期 / 同步状态等字段，即便后端下发也不会写入 `state.plan` / `state.entitlements`；
5. 界面（`AIAgentAccountModal.ts:90`、`AIAgentPane.svelte:105`）只读 `state.plan`，默认值 `base`（`CmdAIAgent.ts:345`），于是标签回落。

一句话：**激活接口下发档位，状态接口不下发；客户端状态刷新也不消费档位。** 两处都缺，才表现为「只有邮箱登录坏」。

## 3. 修法

### 3.1 服务端（生产 release 内 safe_patch，最小增量）

- `StatusResponse` 增加 `plan: str = "base"` 与 `entitlements: dict = {}`；
- `status()` 从 token 的绑定关系取 `plan_type`（`db.resolve_token` 的 SQL 已 `devices JOIN cards` 带出该列），调用**既有** `entitlements_for(plan, get_skills_registry())`，与 `/api/activate` 完全同源；
- 不改 `PLAN_ENTITLEMENTS`、不改 `entitlements_for`、不改任何权限判定 —— 只把已经算好的同一份结果在第二个读接口上补齐；
- 纯增量字段：既有字段的消费方（积分 / 有效期 / 同步状态 / `provisioning_status` 等）不受影响。

### 3.2 客户端（插件）

`refreshStatus()` 增加解析：

- `plan`：仅接受 `base | member | pro`（`isPlanType`），否则**保留旧值**；
- `entitlements`：复用既有 `normalizeEntitlements()` 的 snake_case → camelCase 归一化；字段缺失/非法时保留旧值；
- 重点：**老后端不返回这两个字段时，绝不把已激活的会员降级成 base**（避免把「后端没给」误当成「用户是基础版」）。

`loginWithEmail()` 原本就在成功分支调用 `refreshStatus()`，因此无需新增调用点；修复点是让这次刷新真的能消费到档位。

## 4. 单测

### 4.1 服务端

新增 `tests/test_status_plan_entitlements.py`（4 例，不联网、不起服务，直接调 `routes.status()`）：

- 走**真实** `EmailAuthService.verify_code` 签发设备 token（首次即注册、账户已绑卡密），再调 `GET /api/status` 对应处理函数；
- member → `plan=member`，`entitlements == entitlements_for("member", registry)`，`schedules=true`，`max_devices=5`；
- pro → `plan=pro`，`cloud_vault=true`，`max_devices=10`；
- base → `plan=base`，`schedules=false`、`cloud_vault=false`（补齐字段不多给权益）；
- 读接口与激活接口对同一卡密必须给出同一份 `plan` / `entitlements`（同源锁定）。

全量回归：`/srv/osyc/venv/bin/python -m unittest discover -s tests -t .` → **397 tests OK**（基线 393 + 本次 4）。

### 4.2 插件

新增 `src/osyc/features/AIAgent/CmdAIAgent.tierLabel.unit.spec.ts`（6 例）：

- 邮箱登录 member / pro / base：`loginWithEmail()` 之后 `state.plan` 分别为 `member` / `pro` / `base`，`state.entitlements` 字段正确（`maxDevices`、`schedules`、`cloudVault`）；
- `refreshStatus()` 单独解析 snake_case `plan` / `entitlements`；
- 老后端缺字段时保留既有档位（不回落 base）；
- 非法 plan 值保留既有档位。

## 5. 真实验证（生产 release 内真实 HTTP）

用**自建测试卡**（member / pro 各一张，验证后即删除）走与买家一致的链路：`POST /api/email/verify`（验证码直接写库、不发信）→ 取 token → `GET /api/status`。全程未触碰任何真实卡密，输出已脱敏（不含卡密、token、setup URI）。

```json
{
  "verified": [
    {
      "login_path": "POST /api/email/verify -> GET /api/status",
      "plan": "member",
      "entitlements": {
        "sync": true,
        "ai_tasks": true,
        "schedules": true,
        "cloud_vault": false,
        "cloud_quota_mb": 0.0,
        "max_devices": 5,
        "skills": [
          "basic-organize", "defuddle", "json-canvas", "obsidian-bases",
          "obsidian-cli", "obsidian-markdown", "graph-ai", "layout-polish", "smart-daily"
        ],
        "skill_bodies": true
      },
      "matches_entitlements_for": true
    },
    {
      "login_path": "POST /api/email/verify -> GET /api/status",
      "plan": "pro",
      "entitlements": {
        "sync": true,
        "ai_tasks": true,
        "schedules": true,
        "cloud_vault": true,
        "cloud_quota_mb": 333.33,
        "max_devices": 10,
        "skills": [
          "basic-organize", "defuddle", "json-canvas", "obsidian-bases",
          "obsidian-cli", "obsidian-markdown", "graph-ai", "layout-polish",
          "smart-daily", "cloud-vault", "priority", "theme-custom"
        ],
        "skill_bodies": true
      },
      "matches_entitlements_for": true
    }
  ]
}
```

补充：`systemctl restart osyc-api` **仅重启一次**；`GET /health` 返回 **HTTP 200**（`api` / `bridge_socket` / `sync_configured` / `hermes_endpoint` 全 true）。

## 6. 未验证项 / 已知边界

1. **插件 UI 端到端未验证**：本环境没有 Obsidian 运行环境，档位标签的肉眼验收需在真实 Obsidian 里完成。已做的是单测级 `state.plan` → 标签映射链路（标签是 `state.plan` 的纯映射）。
2. **既有技能目录权限缺陷（非本次引入，未修）**：线上 `skills/` 下 `batch-refactor`、`link-doctor`、`note-merge`、`vault-audit`、`vault-qa`、`weekly-review` 六个目录权限为 `700 root`，服务以 `osyc` 身份运行读不到，因此线上 member / pro 实际下发的 `entitlements.skills` 少于目录清单（上面的真实验证输出即反映这一点）。**修目录权限等于变更用户权益**，超出 D6 范围，建议单独审批处理。
3. **老客户端不受益**：2.0.16 及更早的插件即使后端已补齐字段也不会消费（`refreshStatus()` 不解析），需要装 2.0.17。
4. **`sha256sum -c` 既有不一致**：`./deploy/runtime-manifest.json` 在 release 生成时晚于 `SHA256SUMS` 被 release-id 覆写，非本次引入。

## 7. 合规

- 本文档不含任何真实卡密、口令或 setup URI；
- 本文档不含任何法币 / 金额等值口径，权益只按后端的布尔 / 整数 / 技能清单字段描述。

