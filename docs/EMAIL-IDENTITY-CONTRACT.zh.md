# 邮箱身份口径核对（客户端 ↔ 服务端）

> 基线：`release/2.0.14`（HEAD `1a0306e`）。核对日期 2026-09-20。
> 目的：在「工具中心 → 账户页」新增邮箱账户入口与 Pro 独立同步空间入口之前，把
> **服务端已实现的能力**与**客户端已实现的能力**逐条对齐，标出缺口。
>
> 本文只记录接口契约与缺口，**不包含**任何真实卡密、口令、setup URI 或邮箱地址。

---

## 0. 核对范围与依据

| 侧 | 文件 | 关注点 |
|---|---|---|
| 服务端 | `backend/app/email_auth.py` | `EmailAuthService` 的四个流程：发码 / 校验 / 绑邮箱 / 绑卡密 |
| 服务端 | `backend/app/api/routes.py` L718–L810 | 四个 HTTP 路由与请求模型 |
| 客户端 | `src/osyc/features/AIAgent/CmdAIAgent.ts` L606–L712 | 邮箱账户三方法 + 错误码文案 |
| 客户端 | `src/osyc/features/AIAgent/AIAgentAccountModal.ts` L501–L624 | 邮箱区块 UI（地址 / 发码 60s 倒计时 / 验证码登录 / 绑定卡密） |
| 客户端 | `src/osyc/features/AIAgent/AIAgentToolsModal.ts` L82–L122 | 「账户」页（新增入口的落点） |

---

## 1. 服务端能力清单

### 1.1 `POST /api/email/send-code`（routes.py L745）

- 鉴权：无。
- 请求（`EmailSendRequest`）：`{ email: string(3..254), purpose: "login"|"register"|"bind" }`，默认 `login`。
- 实现（`request_code`，email_auth.py L84）：
  1. 邮箱格式校验 `EMAIL_RE`（L22）→ 不合法抛 400「邮箱格式不正确」；
  2. `purpose` 白名单 `("login","bind","register")`，非法值回落 `login`；
  3. 功能开关 `settings.email_login_enabled` 为假 → 501「邮箱功能未启用」；
  4. 频控（进程内滑窗）：同邮箱 **60s 1 次**、同邮箱 **每小时 10 次**、同 IP **每小时 20 次** → 429「请求过于频繁，请稍后再试」；
  5. 生成 **6 位**验证码，只存 `hmac-sha256(code, pepper)`；TTL **300s**；
  6. 发信失败 `MailError` → 503（原文）。
- 成功响应：`{ ok: true, message: "若该邮箱可用，验证码已发送", masked, ttl_seconds: 300 }`（统一文案，防邮箱枚举）。

### 1.2 `POST /api/email/verify`（routes.py L760）

- 鉴权：无。
- 请求（`EmailVerifyRequest`）：`{ email, code(4..8), device_id(1..128), device_name? }`（服务端固定按 `purpose="login"` 消费）。
- 实现（`verify_code`，email_auth.py L136）：
  1. `_consume(email, code, "login")`：无该用途的码 → 400；`attempts >= 5` → 429；已消费 → 400；过期 → 400；哈希不匹配 → 400（并累加 attempts）；
  2. 账户不存在则 `upsert_email_account`（**首次即注册**），记录登录时间；
  3. 取 `cards_for_account`；
  4. 无论是否绑卡，都签发 `session_token = create_account_session(account, device_id)`；
  5. **账户已有卡密且有 device_id** → `activate_device` 签发设备 `token`；设备超限 → 403「设备数量已达上限」；
  6. 无卡密时给 `message: "账户已创建，请先用卡密激活或绑定卡密后使用"`。
- 成功响应：`{ ok, registered, account: { account_id, email_masked }, cards[], session_token, token?, card_key?, message? }`。
- routes 侧附加：返回 `card_key` 且档位为 `member/pro` 时 `ensure_default_route`（失败只记日志，不影响登录）。
- 语义：**登录 / 注册同一条**；邮箱是高于卡密的身份锚点（换设备只需邮箱 + 验证码）。

### 1.3 `POST /api/account/bind-email`（routes.py L783）

- 鉴权：**需要** `current_tenant`（即 Bearer 卡密 token）。
- 请求（`BindEmailRequest`）：`{ email, code(4..8) }`。
- 实现（`bind_email`，email_auth.py L175）：
  1. `_consume(email, code, "bind")` —— **只认 `purpose="bind"` 的验证码**；
  2. 账户不存在则创建；
  3. `link_account_card(current_card_key, "bind")`，把**当前 tenant 的卡密**并入邮箱账户；
  4. 返回 `{ ok: true, message: "邮箱已绑定", email_masked, cards[] }`。
- 注意：不会返回设备 token，也不改本机 `settings.token`（绑定是「卡密 → 邮箱」方向）。

### 1.4 `POST /api/account/bind-card`（routes.py L798）

- 鉴权：无 Bearer（凭 `session_token`）。
- 请求（`BindCardRequest`）：`{ card_key(1..64), session_token(8..128), device_id?, device_name? }`。
- 实现（`bind_card`，email_auth.py L183）：
  1. `get_card` 不存在 → 404「卡密无效」；
  2. `account_for_session` 无效 → 401「邮箱会话已失效，请重新验证邮箱」；
  3. `link_account_card(..., "claim")`；
  4. 有设备时 `activate_device` 签发 `token`；设备超限**不整体失败**，改为 `device_limit_reached: true` + 专属 message。
- 成功响应：`{ ok, message, cards[], token?, card_key?, device_id?, device_limit_reached? }`。

### 1.5 服务端状态码 → 语义汇总

| 状态 | send-code | verify | bind-email | bind-card |
|---|---|---|---|---|
| 400 | 邮箱格式不正确 | 验证码无效/过期/已使用 | 验证码无效/过期 | — |
| 401 | — | — | — | 会话失效 |
| 403 | — | 设备数量已达上限 | — | — |
| 404 | — | — | — | 卡密无效 |
| 429 | 发码过频 | 尝试次数过多 | — | — |
| 501 | 功能未启用 | 功能未启用 | — | — |
| 503 | 邮件发送失败 | — | — | — |

---

## 2. 客户端能力清单

### 2.1 `CmdAIAgent`（L606–L712）

| 方法 | 行 | 调用 | 说明 |
|---|---|---|---|
| `requestEmailCode(email)` | L612 | `POST /api/email/send-code` | **`purpose: "login"` 硬编码**；成功文案「验证码已发送至 X，5 分钟内有效」 |
| `loginWithEmail(email, code)` | L631 | `POST /api/email/verify` | 传 `device_id/device_name`；把 `res.session_token` 存进 `emailAccount.session`；有 `token` 时覆盖 `settings.token`、`activated=true`、`refreshStatus()` |
| `bindCardToEmail(cardKey)` | L668 | `POST /api/account/bind-card` | 需要 `emailAccount.session`，否则「请先用邮箱验证码登录，再绑定卡密」；处理 `device_limit_reached` |
| `emailAccount` | L609 | — | `{ masked, cards[], session }`，**只内存、不落盘**（L394 注释） |
| `describeEmailError(status)` | L703 | — | 仅按状态码给固定中文，忽略服务端 `detail` |

### 2.2 UI：`AIAgentAccountModal.renderEmailLogin`（L507–L624）

- 说明文案（邮箱是身份锚点）；
- 「邮箱地址」输入框 + 「发送验证码」按钮，成功后 **60s 倒计时**（`startCountdown(60)`）；
- 「验证码」输入框 + 「登录」按钮（`loginWithEmail`）；
- 状态行：未登录显示「尚未验证邮箱」；已登录显示「已登录 <masked>」并列出已关联卡密；
- 「绑定卡密」输入框 + 「绑定」按钮（`bindCardToEmail`）。
- 该区块位于账户弹窗「账户操作」折叠体内（L140–L146）。

### 2.3 UI：`AIAgentToolsModal`「账户」页（L82–L122）

- 现有条目：**我的账户**（打开账户详情）、**Cloud-Vault 备份**（条件显示）、**OsyC 设置**。
- 目前**没有**邮箱入口，也**没有**独立同步空间入口 —— 本次要补的就是这两行。

---

## 3. 缺口清单（现状 / 需要补什么）

> 图例：**[硬缺口]** = 当前必然失败或能力不可达；**[软缺口]** = 可用但文案/口径不完整。

### G1 · bind-email 缺 UI，且验证码用途对不上 **[硬缺口]**

- **现状**：服务端 `POST /api/account/bind-email` 完整可用，但客户端**没有**任何方法调用它，也没有入口；
  更关键的是 `bind_email` 只认 `purpose="bind"` 的验证码，而客户端 `requestEmailCode` **固定发 `purpose: "login"`**。
  因此即使补上 UI 直接调用服务端，`latest_email_code(hash, "bind")` 必然取不到行 → 400「验证码无效或已过期」。
- **需要补什么**：
  1. 客户端 `requestEmailCode(email, purpose)` 支持传 `bind`（send-code 已经接受该字段）；
  2. 新增 `CmdAIAgent.bindEmailToAccount(email, code)` 调 `/api/account/bind-email`；
  3. 才谈 UI 入口。
- **本次范围**：不实现（本次入口复用现有邮箱区块的「登录/注册/绑定卡密」，bind-email 是另一条链）。此处显式登记，避免误以为已闭环。

### G2 · 邮箱会话只存内存，重启需重新验证 **[软缺口]**

- **现状**：`emailAccount` 刻意不落盘（安全口径，见 L393-L394 与 `CmdAIAgent.email.unit.spec.ts`），插件重启后
  `emailAccount` 为 `null`，需要重新走一次邮箱验证；UI 状态行只写「尚未验证邮箱」。
- **需要补什么**：产品确认是否接受「每次重启重新验证」；若接受，在状态行补一句明确说明（否则用户会以为掉登录）。
  本次入口的状态文案按「未登录」如实显示，不承诺持久会话。

### G3 · 错误码文案不分流，忽略服务端 detail **[软缺口]**

- **现状**：`describeEmailError` 仅按状态码给一句固定文案。400 同时覆盖「邮箱格式不正确 / 验证码已过期 /
  验证码已被使用 / 验证码无效」，统一显示「验证码无效或已过期」，会把「邮箱写错」误导成「验证码不对」；
  429 同时覆盖「发码过频」与「尝试次数过多」，统一显示「操作过于频繁，请稍后再试」。
- **需要补什么**：按调用上下文（发码 / 校验 / 绑卡）分流 400/429 文案，或优先透出服务端 `detail`（需脱敏），
  至少保证「邮箱格式不正确」能单独提示。本次不改动既有文案。

### G4 · 两个「绑定」方向容易混淆 **[软缺口]**

- **现状**：`verify` / `bind-card`（反向：邮箱账户并吞卡密）已有 UI；`bind-email`（正向：当前卡密并入邮箱账户）无 UI。
  两者都叫「绑定」，用户无法区分。
- **需要补什么**：若未来补 bind-email UI，需明确区分「把卡密绑到邮箱」与「用邮箱登录后并入新卡密」两个方向，
  并在入口文案中说清前置条件（前者需邮件 bind 用途验证码，后者需先完成邮箱登录）。

### G5 · 设备超限的两个分支文案来源不同 **[软缺口]**

- **现状**：`verify` 的设备超限是服务端 403「设备数量已达上限」，客户端改写为「本设备已达该卡密上限，请先解绑旧设备」；
  `bind-card` 的设备超限是 200 + `device_limit_reached`，客户端透出服务端 message。两条路径都在，行为可接受。
- **需要补什么**：无（仅记录：403 文案是客户端改写，不是服务端原文）。

### G6 · 登录成功会写入 `settings.token` 并置 `activated`（非自动切换空间）

- **现状**：`loginWithEmail` 在服务端签发设备 token 时直接覆盖本地 token 并激活 —— 这是邮箱登录流程的**必要结果**。
- **需要补什么**：无。本次新增入口只负责**打开界面**，不在入口渲染时自动调用登录，也不自动切换同步空间，
  与「显式动作」约束一致。

### G7 · 防枚举文案与客户端文案不一致

- **现状**：服务端成功响应固定「若该邮箱可用，验证码已发送」；客户端在 2xx 时改写为「验证码已发送至 <原文邮箱>，5 分钟内有效」。
- **需要补什么**：产品确认是否保留客户端改写（会回显用户输入原文，非哈希）。仅为文案口径记录。

---

## 4. 本次入口实现与缺口的边界

- **邮箱入口**：复用账户弹窗的邮箱区块（发码 60s 倒计时 / 验证码登录 / 绑定卡密），点击只打开界面，
  **不自动发码、不自动登录**；入口行状态显示「未登录 / 已登录 <masked> · 已绑定 N 个卡密」。
- **同步空间入口**：复用账户弹窗的 Pro 区块，打开时只做一次**只读 GET** 回显；真正开通/切换仍必须用户点击
  「开通并切换到独立空间」（`requestProNamespace`）。入口行状态显示「未开通 / 已开通 / 只读保留 + 已用用量」。
- **不在本次范围**：G1 的 bind-email 全链路（含 `purpose="bind"`）、G3 文案分流、G4 方向区分。
