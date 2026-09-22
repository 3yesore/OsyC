# 邮箱身份口径核对（客户端 ↔ 服务端）

> 基线：`origin/main`（2.0.17，HEAD `391268c`）。首次核对日期 2026-09-20。
> 更新（2026-09-21，`release/2.0.15`）：已补上 G1 的 bind-email 客户端消费者与 UI 入口，
> 并顺带修掉 G2 / G3 / G4。
> 更新（2026-09-22，分支 `codex/email-complete-2.0.18`，基线 2.0.17）：G5 / G7 落实为
> 「服务端单一文案 + 客户端不再改写」；补上邮箱登录的档位/权益端到端单测、未激活邮箱的
> 引导与两处会话提示，以及服务端 `/api/account/bind-card` 的速率限制与审计事件。
> 下文每条缺口都标注了「已实现」或「仍待办」。
> 目的：把**服务端已实现的能力**与**客户端已实现的能力**逐条对齐，标出缺口。
>
> 本文只记录接口契约与缺口，**不包含**任何真实卡密、口令、setup URI 或邮箱地址。

---

## 0. 核对范围与依据

| 侧 | 文件 | 关注点 |
|---|---|---|
| 服务端 | `backend/app/email_auth.py` | `EmailAuthService` 的四个流程：发码 / 校验 / 绑邮箱 / 绑卡密 |
| 服务端 | `backend/app/api/routes.py` L718–L810 | 四个 HTTP 路由与请求模型 |
| 客户端 | `src/osyc/features/AIAgent/CmdAIAgent.ts` | 邮箱账户方法 + `purpose` + 错误码文案（2.0.15 增加 bind-email 消费者） |
| 客户端 | `src/osyc/features/AIAgent/osycAccountSections.ts` | 共享邮箱区块 UI（地址 / 发码 60s 倒计时 / 登录 / 两个方向的绑定） |
| 客户端 | `src/osyc/features/AIAgent/AIAgentAccountModal.ts` | 账户弹窗委托共享区块 |
| 客户端 | `src/osyc/features/AIAgent/AIAgentToolsModal.ts` L82–L122 | 「账户」页（新增入口的落点） |

> 下文标记的 L 行号以首次核对的基线为准，随改动会漂移；以函数名 / 常量名为准。

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
  5. **账户已有卡密且有 device_id** → `activate_device` 签发设备 `token`；设备超限 → 403 `DEVICE_LIMIT_MESSAGE`（「本设备已达该卡密上限，请先解绑旧设备」，2.0.18 起统一），并记 `device_limit` 审计事件；
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
  4. 频控（2.0.18 新增）：按 **账户 + 设备** 滑窗 60s/10 限流；
  5. 有设备时 `activate_device` 签发 `token`；设备超限**不整体失败**，改为 `device_limit_reached: true`
     + 统一的 `DEVICE_LIMIT_MESSAGE`，并记 `device_limit` 审计事件；无论成功与否都记 `bound` 审计事件。
- 成功响应：`{ ok, message, cards[], card_linked, token?, card_key?, device_id?, device_limit_reached? }`。

### 1.5 服务端状态码 → 语义汇总

| 状态 | send-code | verify | bind-email | bind-card |
|---|---|---|---|---|
| 400 | 邮箱格式不正确 | 验证码无效/过期/已使用 | 验证码无效/过期 | — |
| 401 | — | — | — | 会话失效 |
| 403 | — | `DEVICE_LIMIT_MESSAGE`（2.0.18 起与 bind-card 共用同一句） | — | — |
| 404 | — | — | — | 卡密无效 |
| 429 | 发码过频 | 尝试次数过多 | — | 绑定过频（2.0.18 新增） |
| 501 | 功能未启用 | 功能未启用 | — | — |
| 503 | 邮件发送失败 | — | — | — |

---

## 2. 客户端能力清单

### 2.1 `CmdAIAgent`（2.0.15）

| 方法 | 行 | 调用 | 说明 |
|---|---|---|---|
| `requestEmailCode(email, purpose = "login")` | L666 | `POST /api/email/send-code` | **2.0.15 起支持 `purpose`**（`login` / `register` / `bind`），默认 `login` 保持向后兼容；绑定邮箱必须传 `bind` |
| `loginWithEmail(email, code)` | L688 | `POST /api/email/verify` | 传 `device_id/device_name`；把 `res.session_token` 存进 `emailAccount.session`；有 `token` 时覆盖 `settings.token`、`activated=true`、`refreshStatus()`（邮箱 → 卡密） |
| `bindCardToEmail(cardKey)` | L725 | `POST /api/account/bind-card` | 方向「邮箱 → 卡密」；需要 `emailAccount.session`，否则「请先用邮箱验证码登录，再绑定卡密」；处理 `device_limit_reached` |
| `bindEmailToAccount(email, code)` | L769 | `POST /api/account/bind-email` | **2.0.15 新增**；方向「卡密 → 邮箱」；需要已激活卡密 token（Bearer），未激活不发请求；成功只刷新内存掩码 / 卡密并留只读回显，不签发 session |
| `emailAccount` | L652 | — | `{ masked, cards[], session }`，**只内存、不落盘** |
| `emailBindSummary` | L658 | — | **2.0.15 新增**；最近一次「卡密 → 邮箱」绑定的只读回显，只内存、不代表已登录 |
| `describeEmailError(status, data)` | L808 | — | **2.0.15 起优先回显服务端 `detail`**（去控制字符 / 折叠空白 / 240 字截断），缺失时按状态码兜底 |

### 2.2 UI：共享邮箱区块 `osycAccountSections.renderEmailAccountSection`

- 说明文案（邮箱是身份锚点）+ **G2 说明**「邮箱会话仅在本次运行有效，重启 Obsidian 后需重新验证」；
- 「邮箱地址」输入框 + 「发送验证码」按钮（`requestEmailCode(email, "login")`），成功后 **60s 倒计时**（`startCountdown(60)`）；
- 「验证码」输入框 + 「登录」按钮（`loginWithEmail`）；
- 状态行：未登录显示「尚未验证邮箱（含 G2 说明）」；已登录显示「已登录 <masked>（含 G2 说明）」并列出已关联卡密；
- **方向一 heading「邮箱 → 卡密（用邮箱账户并入卡密）」**：「绑定卡密」输入框 + 「绑定」按钮（`bindCardToEmail`）；
- **方向二 heading「卡密 → 邮箱（绑定当前卡密）」**：「绑定验证码」输入框 + 「发送绑定验证码」按钮
  （`requestEmailCode(email, "bind")`，60s 倒计时）+ 「绑定到邮箱」按钮（`bindEmailToAccount`）；成功后 `ctx.refresh()` 回显；
- 所有动作（发码 / 登录 / 两种绑定）都只在用户点击时执行，渲染区块本身不发任何请求。
- 该区块同时被账户弹窗「账户操作」折叠体与工具中心入口弹窗复用，不存在第二套实现。

### 2.3 UI：`AIAgentToolsModal`「账户」页

- 本节记录的是 2.0.14 引入入口**之前**的基线：当时只有 **我的账户** 一条。
- 2.0.14 起已加入「邮箱账户」与「独立同步空间（Pro）」两个入口，均复用共享区块（`osycAccountSections.ts`）；
  点击入口只打开界面，不自动登录 / 发码 / 切换空间。

---

## 3. 缺口清单（现状 / 需要补什么）

> 图例：**[硬缺口]** = 当前必然失败或能力不可达；**[软缺口]** = 可用但文案/口径不完整。

### G1 · bind-email 缺 UI，且验证码用途对不上 **[硬缺口 → 已在 2.0.15 实现]**

- **原现状**：服务端 `POST /api/account/bind-email` 完整可用，但客户端**没有**任何方法调用它，也没有入口；
  更关键的是 `bind_email` 只认 `purpose="bind"` 的验证码，而客户端 `requestEmailCode` **固定发 `purpose: "login"`**。
- **2.0.15 实现**：
  1. `CmdAIAgent.requestEmailCode(email, purpose = "login")` 支持 `login | register | bind`（默认 `login`，向后兼容）；
  2. 新增 `CmdAIAgent.bindEmailToAccount(email, code)` 调 `POST /api/account/bind-email`，复用 `call()` 的 Bearer 卡密 token，
     未激活时直接返回「请先激活卡密，再把当前卡密绑定到邮箱」，不发请求；
  3. UI 落在共享的 `osycAccountSections.ts` 邮箱区块：「绑定验证码」输入框 + 「发送绑定验证码」
     （`requestEmailCode(email, "bind")`，60s 倒计时）+ 「绑定到邮箱」（`bindEmailToAccount`）；成功后 `ctx.refresh()`。
- **仍未做**：无。但**未在真机 Obsidian 上点击验证**，只过了单元测试与 `tsc --noEmit`。

### G2 · 邮箱会话只存内存，重启需重新验证 **[软缺口 → 已在 2.0.15 实现（文案）]**

- **现状**：`emailAccount` 仍刻意不落盘（安全口径，见 `CmdAIAgent.email.unit.spec.ts`），插件重启后为 `null`，
  需要重新走一次邮箱验证。这是既定口径，本次不改持久会话。
- **2.0.15 实现**：共享邮箱区块导出 `EMAIL_SESSION_HINT = "邮箱会话仅在本次运行有效，重启 Obsidian 后需重新验证"`，
  写在说明行与状态行里，避免用户把重启后的重新验证当成「掉登录」。
- **仍未做**：「是否接受每次重启重新验证」的产品决策未变；若未来要求持久会话，需单独设计安全存储。

### G3 · 错误码文案不分流，忽略服务端 detail **[软缺口 → 已在 2.0.15 实现]**

- **原现状**：`describeEmailError` 仅按状态码给一句固定文案，400 / 429 下多种原因被合并，会把「邮箱写错」误导成「验证码不对」。
- **2.0.15 实现**：`describeEmailError(status, data)` 先用 `readEmailErrorDetail(data)` 优先回显服务端 `detail`
  （去控制字符、折叠空白、截断到 240 字），`detail` 缺失或非法时才回落到状态码固定文案；
  `requestEmailCode` / `loginWithEmail` / `bindCardToEmail` / `bindEmailToAccount` 四个调用点都改传 `data`。
- **仍未做**：无（「邮箱格式不正确」等已能单独提示）。

### G4 · 两个「绑定」方向容易混淆 **[软缺口 → 已在 2.0.15 实现]**

- **原现状**：`verify` / `bind-card`（反向：邮箱账户并吞卡密）已有 UI；`bind-email`（正向：当前卡密并入邮箱账户）无 UI，两者都叫「绑定」。
- **2.0.15 实现**：共享邮箱区块用两个 heading 与方向描述显式区分：
  `EMAIL_BIND_DIRECTION_REVERSE = "邮箱 → 卡密（用邮箱账户并入卡密）"`（`bindCardToEmail`，需先邮箱验证码登录）；
  `EMAIL_BIND_DIRECTION_FORWARD = "卡密 → 邮箱（绑定当前卡密）"`（`bindEmailToAccount`，需已激活卡密 + `purpose="bind"` 验证码）。
- **仍未做**：无。

### G5 · 设备超限的两个分支文案来源不同 **[已实现 · 2.0.18]**

- **原现状**：`bind-card` 的设备超限是 200 + `device_limit_reached` + 带前缀的服务端 message；
  `verify` 的 403 是「设备数量已达上限」；客户端 403 兜底又是「本设备已达该卡密上限，请先解绑旧设备」，
  同一「设备超限」出现三种措辞。
- **2.0.18 实现**：
  1. 服务端新增唯一常量 `DEVICE_LIMIT_MESSAGE = "本设备已达该卡密上限，请先解绑旧设备"`
     （`backend/app/email_auth.py`），`verify` 的 403 与 `bind-card` 的 `device_limit_reached` 共用同一句；
  2. `bind-card` 不再把「卡密已并入账户」写进 message，改用机器可读字段 `card_linked: true` 表达并入事实；
  3. 客户端新增 `EMAIL_DEVICE_LIMIT_MESSAGE`（`CmdAIAgent.ts`），`describeEmailError(403)`、
     `bindCardToEmail` 的 `device_limit_reached`、`bindEmailToAccount` 的（防御性）同一信号都回落到它。
- **仍未做**：无。

### G6 · 登录成功会写入 `settings.token` 并置 `activated`（非自动切换空间） **[仍待办：无]**

- **现状**：`loginWithEmail` 在服务端签发设备 token 时直接覆盖本地 token 并激活 —— 这是邮箱登录流程的**必要结果**。
- **仍待办**：无。新增的 bind-email 入口只在用户点击时执行；渲染时既不自动登录，也不自动切换同步空间。

### G7 · 防枚举文案与客户端文案不一致 **[已实现 · 2.0.18]**

- **原现状**：服务端成功响应固定「若该邮箱可用，验证码已发送」；客户端在 2xx 时改写为
  「验证码已发送至 <原文邮箱>，5 分钟内有效」，既替换了防枚举文案，也回显了用户输入的明文邮箱。
- **2.0.18 实现**：客户端 2xx 只回显服务端 `message`，缺失时用同一句中性兜底，绝不回显明文邮箱
  （`CmdAIAgent.requestEmailCode`）；共享邮箱区块的两个「发送验证码 / 发送绑定验证码」状态行
  也改为直接 `setStatus(result.message)`，删掉本地拼接。
- **仍未做**：无。

---

## 4. 入口实现与缺口的边界（2.0.15）

- **邮箱入口**：复用账户弹窗 / 工具中心的共享邮箱区块（`osycAccountSections.ts`）。点击入口只打开界面，
  **不自动发码、不自动登录、不自动绑定**；60s 倒计时只解禁按钮，真正发码仍由点击触发。
- **两个绑定方向**：`卡密 → 邮箱`（`bindEmailToAccount`，需已激活卡密 + `purpose="bind"` 验证码）与
  `邮箱 → 卡密`（`bindCardToEmail`，需先完成邮箱验证码登录）在 UI 上有独立 heading 与方向说明。
- **同步空间入口**：复用账户弹窗的 Pro 区块，打开时只做一次**只读 GET** 回显；真正开通/切换仍必须用户点击
  「开通并切换到独立空间」（`requestProNamespace`）。
- **已在 2.0.15 完成**：G1、G2、G3、G4。
- **已在 2.0.18 完成**：G5、G7，以及下面第 5 节的三项收尾。
- **仍待办 / 仅记录**：G6（无需动作：邮箱登录写 `settings.token` 并激活是流程必要结果）。
- **未验证**：真机 Obsidian 点击流程未跑（只过单元测试与 `tsc` / `lint` / `svelte-check`）；
  服务端已在 `/srv/osyc/current` 通过全量 unittest 并重启 `osyc-api` 一次。

---

## 5. 2.0.18 收尾项（邮箱身份 · 买家可见）

> 本节记录 2.0.18 在 G1–G4 之上的三项收尾，均已在分支 `codex/email-complete-2.0.18`（基线 2.0.17）实现。

### 5.1 邮箱登录 → 档位 / 权益标签 **[已实现 · 已补端到端单测]**

- **链路**：`loginWithEmail` 在服务端签发设备 token 时覆盖 `settings.token`、置 `activated`，
  随后调用 `refreshStatus()`（`GET /api/status`）；`/api/status` 下发 `plan` 与 snake_case
  `entitlements`，由 `CmdAIAgent` 映射为 `state.plan` / `state.entitlements`
  （`maxDevices` / `cloudVault` / `schedules` / `cloudQuotaMb` 等）。
- **单测**：`CmdAIAgent.tierLabel.unit.spec.ts` 覆盖 member / pro / base 三档；2.0.18 追加一条
  端到端式用例：`send-code`（防枚举文案）→ `verify`（签发 token）→ `status`（pro 权益），
  断言 `state.plan === "pro"`、`PLAN_LABEL` 显示「Pro」、`maxDevices === 10`、
  `cloudVault === true`、`cloudQuotaMb ≈ 333.33`，且发码文案不含明文邮箱。
- **仍未做**：无。服务端 `/api/status` 的 `plan` / `entitlements` 由
  `backend/tests/test_status_plan_entitlements.py` 锁定。

### 5.2 未激活但已登录邮箱的引导 + 会话提示 **[已实现 · 2.0.18]**

- **引导**：共享区块新增 `EMAIL_UNACTIVATED_HINT = "绑定卡密后即可使用"`；
  `describeEmailEntryStatus`（工具中心入口行）与 `describeEmailSessionStatus`（区块状态行）
  都会在「已登录但未绑定卡密」时给出该引导，且不报错。
- **两处可见**：账户弹窗（`AIAgentAccountModal`）与工具中心账户页（`OsycAccountSectionModal`）
  都渲染同一份 `renderEmailAccountSection`，会话提示 `EMAIL_SESSION_HINT` 只维护一份；
  账户弹窗在未激活时还在首屏直接给出同一提示与引导，不依赖展开折叠体。
- **仍未做**：无。会话仍只存内存（见 G2），重启需重新验证是既定口径。

### 5.3 服务端速率限制与审计事件 **[已实现 · 2.0.18]**

| 接口 | 速率限制 | 审计事件（`record_email_event`） |
|---|---|---|
| `POST /api/email/send-code` | 邮箱 60s/1、邮箱 1h/10、IP 1h/20 | `sent` / `send_failed` |
| `POST /api/email/verify` | 邮箱 10min/12（`_consume`） | `verified`；2.0.18 新增 403 设备超限的 `device_limit` |
| `POST /api/account/bind-email` | 邮箱 10min/12（`_consume`，`purpose=bind`） | `bound` |
| `POST /api/account/bind-card` | **2.0.18 新增**：账户+设备 60s/10 | **2.0.18 新增**：`bound` / `device_limit` |

- **未改动**：任何档位权益数值（`entitlements_for`）与支付相关代码均未触碰。
- **单测**：`backend/tests/test_email_auth.py`（verify 403 统一文案 + `device_limit` 审计）、
  `backend/tests/test_email_account_session.py`（bind-card 限流 429、成功审计、设备超限统一文案 + `device_limit` 审计）。
