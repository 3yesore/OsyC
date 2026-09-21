# OsyC 2.0.16 上架阻断修复说明（插件侧）

> 适用分支：`codex/launch-fix-2.0.16`，基线 `origin/main` = **2185a54**（已发布的 2.0.15）。
> 本文只记录**插件侧**的三条修复（B2 / D4 / D5）。服务端 Pro 路由缺失（另一条上架阻断）
> 由并行代理在服务端仓库修复，**本文与本次改动均未触碰服务端**。
> 文中的「实测」来自买家可用性验收的现场记录；插件侧三处修复**尚未在真机首启路径上验证**（见文末）。
> 严禁在代码、测试、本文档或提交信息里写入任何真实卡密、口令、setup URI 或凭据。

---

## 0. 修复总览

| 编号 | 级别 | 一句话 | 落点 |
| --- | --- | --- | --- |
| B2 | 上架阻断（必修） | 全新安装首启时 `apiBase` 保持空串，第一次点激活不发请求 | `src/osyc/serviceFeatures/useAIAgentUI.ts` |
| D4 | 上架阻断（文案） | 401/402/426 状态码文案误导买家，且激活失败不回显服务端 `detail` | `src/osyc/features/AIAgent/CmdAIAgent.ts` |
| D5 | 口径统一 | 卡密只做 `trim` 不做 `upper`，小写/带空格会 401 | `src/osyc/features/AIAgent/CmdAIAgent.ts` |

---

## B2 · 全新安装首启不发激活请求（阻断，必修）

### 现象

全新安装、首次启动后，买家在 OC 面板输入卡密并点「激活」，看到的不是网络结果，
而是固定提示 **「尚未配置 OsyC 服务地址，请先在设置中完成配置」**；
服务端日志里没有任何 `/api/activate` 请求 —— 请求根本没发出去。

### 根因

`src/osyc/serviceFeatures/useAIAgentUI.ts` 的 `onInitialise` 里：

- 「**有** `.obsidian/livesync-aiagent.json`」的分支会执行
  `agent.configure(resolveServiceUrl(saved.apiBase), saved.token ?? "")`，
  `apiBase` 因此被解析到官方默认入口；
- 「**没有**该文件」的分支只做了 `agent.deviceId = createDeviceId()` + `applyAppearance()` + `persist()`，
  **没有调用 `agent.configure(...)`**。

于是全新买家（必然没有该文件）的 `CmdAIAgent.settings.apiBase` 一直是空串。
`activate()` 开头就是 `if (!this.hasApiBase) return { ok:false, message: this.configurationError() }`，
在发请求之前直接短路。设置页的占位符虽已显示官方默认地址，但那只是 `placeholder`，不写回运行时。

### 修法

在读取持久化配置的**兜底路径**上先无条件落下官方默认地址（`useAIAgentUI.ts`，
`attachTripleTap()` 之后、`if (adapter)` 之前）：

```ts
agent.configure(resolveServiceUrl(undefined), "");
```

- `resolveServiceUrl(undefined)` 命中 `serviceDefaults.ts` 的空值分支，返回
  `DEFAULT_SERVICE_URL` = `https://api4.sacu3.cn`（唯一官方直连入口）；
- 有配置文件时，后面的加载分支会用 `resolveServiceUrl(saved.apiBase)` + `saved.token`
  **覆盖**这次兜底，老用户行为不变；
- 无 adapter / 读取抛异常等其它兜底路径也一并被这次调用覆盖；
- `configure()` 在此时只重置会话态（`sessionCardKey` / `runtimeInfo`，此刻本就为空），
  不写文件、不发请求，副作用可忽略。

**边界声明**：本次只在 `useAIAgentUI` 的初始化路径加了一行兜底，
**未改动** `livesyncPatch.ts` / `livesyncActivation.ts` / `serviceDefaults.ts` 的核心逻辑。

### 单测

- 行为级（新增 `src/osyc/serviceFeatures/useAIAgentUI.boot.unit.spec.ts`）：
  用最小替身接上`useAIAgentUI`（`adapter.exists()` 恒为 `false`，即「无 configPath」），
  执行真实的 `onInitialise` 处理器后断言
  1. `agent.settings.apiBase === DEFAULT_SERVICE_URL`；
  2. 随后 `agent.activate("card-key")` **确实发出了请求**，且第一个请求 URL 为
     `https://api4.sacu3.cn/api/activate`（即不再被 `configurationError` 拦下）。
- 源码回归护栏（`useAIAgentUI.unit.spec.ts`）：兜底 `agent.configure(resolveServiceUrl(undefined), "")`
  必须存在，且位置早于 `onInitialise` 内「有配置文件」的 `adapter.exists(configPath)` 分支。
- 聚焦断言（`CmdAIAgent.unit.spec.ts`）：`resolveServiceUrl(undefined) === DEFAULT_SERVICE_URL`，
  且以此地址配置后 `activate` 的第一个请求确为官方默认入口。

### 未验证项

- **真机首启路径未验**：上述行为测试是 Node 下用替身跑的真实初始化代码，
  不等于真机（Obsidian 冷启动 + 无配置文件 + 首次点击激活）已通过。需按文末清单补真机。
- 未验证「无 adapter」这一极端分支在真机上的表现（正常 vault 不会走到）。

---

## D4 · 状态码文案误导 + 激活失败丢服务端 `detail`（阻断级文案，必修）

### 现象

买家在激活/续费时看到与真实原因不符的提示：

- HTTP 401 → 现在显示「未激活或登录已失效，请重新输入卡密」（应能区分**卡密无效**）；
- HTTP 402 → 现在显示「积分不足，请充值后再试」，会让买家以为要充值，
  而服务端 402 实测表示**卡密已过期**；
- HTTP 426 → 落到默认分支，显示「服务端错误（426）」，把服务端下发的
  **版本指引**整个丢掉了。

### 根因

两处叠加：

1. `describeError(status)` 的状态码映射写错：401/402 语义不准，426 没有专门分支；
2. 更关键的是，**激活失败压根没走回显 `detail` 的通道** ——
   `activate()` 里是 `this.describeError(res.status)`，而带 `detail` 优先级的
   `describeResponseError()` 只被 `send()` / `confirm` 等少数路径使用。
   服务端在 426 的 `detail` 里写的版本指引因此永远到不了买家眼前。

### 修法

保守地只改「文案」与「detail 优先级」：

- `describeError` 兜底文案改为：
  - `401` → `卡密无效或登录已失效，请重新输入卡密`；
  - `402` → `卡密已过期，请续费`；
  - `426` → `当前插件版本过旧，请更新插件`（新增分支）；
  - 403 / 429 / default 不动。
- `activate()` 的 `res.status >= 400` 分支改用
  `await this.describeResponseError(res, res.status)`，让服务端 `detail` 优先；
- `describeResponseError` 改为：**detail 存在时直接回显 detail**，缺失/非法/空白才回落
  `describeError`；
- 脱敏与截断统一收口到新导出的 `sanitiseServerDetail(value)`：去 C0/C1 控制字符、
  折叠空白、截断到 240 字符。`readEmailErrorDetail` 复用它，行为与 2.0.15 保持一致
  （原实现已在做同样的控制字符清洗），`describeResponseError` 因此也获得了同级别的脱敏。

> 注意：`detail 优先` 意味着**不再**给服务端文案加「兜底文案：」前缀。这是 D4 明确要求的
> 「只影响文案与 detail 优先级」，不改返回值语义（仍是用户可见字符串）。

### 单测

`CmdAIAgent.unit.spec.ts` 新增：

- 401 无 `detail` → `卡密无效或登录已失效，请重新输入卡密`；
- 402 无 `detail` → `卡密已过期，请续费`（同时把既有 `send()` 402 断言从
  「积分不足，请充值后再试」改为新文案）；
- 426 无 `detail` → `当前插件版本过旧，请更新插件`；
- 426 带多行 `detail` → 优先回显 detail，换行折叠、截断到 240 字符；
- 401 带 `detail` → 原样回显 detail，而不是兜底文案；
- `sanitiseServerDetail` 的控制字符折叠 / 240 字截断 / 非字符串返回 `null`。

### 未验证项

- 服务端 401/402/426 **真实响应体**（`detail` 字段名与文案）未在本机核对，
  以买家验收记录为准；若服务端用 `message`/`error` 承载，本实现同样兼容。
- 426 的「最低可升级版本」是服务端 `detail` 里的自由文本，客户端原样回显、不做解析；
  若服务端 `detail` 为空，买家只会看到兜底文案「当前插件版本过旧，请更新插件」(无具体版本号)。

---

## D5 · 卡密输入口径不一致（最小一致化）

### 现象

同一张卡密，从不同入口输入结果不同：

- `activate` 链路：服务端 `db.get_card` **精确匹配**，插件端只做 `client trim`、不做 upper，
  小写或**内部含空格**的卡密会被判 401「卡密无效」；
- `recharge` / `bind-card` 链路：服务端 `strip + upper` / `upper`，同样的输入却能成功。

### 根因

卡密规范化散落在客户端/服务端两侧、口径不一：客户端 `activate` 只 `trim`，
`bindCardToEmail` 是 `trim + toUpperCase`（仍不去中间空白），服务端三条链路又各不相同。

### 修法（仅客户端，未改服务端）

新增导出函数 `normalizeCardKey(value)`：`value.replace(/\s+/g, "").toUpperCase()`
（`\s+` 覆盖首尾与中间空白，等价于 trim + 去中间空白 + 大写），并在**所有把卡密送出去之前**调用：

- `activate(cardKey)`：请求体 `card_key`、会话 `sessionCardKey`、
  以及 `applySetupUri(setupUri, key)` 的**同一把钥匙**都改用规范化后的值
  （否则会用另一份卡密解密 setup URI，解不出配置）；
- `recharge(cardKey)`：请求体 `card_key`；
- `bindCardToEmail(cardKey)`：改为复用 `normalizeCardKey`（补上去中间空白）；
- 邮箱登录回执里的 `res.card_key` 存会话时也走 `normalizeCardKey`。

**UI 提示不变**：规范化只发生在送出前，界面仍展示/提示买家自己输入的内容，
不新增任何提示、不改变成功/失败文案。

### 单测

`CmdAIAgent.unit.spec.ts` 新增：

- `activate(" abcd-1234 efgh ")` → 请求体 `card_key === "ABCD-1234EFGH"`；
- `recharge(" ab-cd ef ")` → 请求体 `card_key === "AB-CDEF"`；
- `normalizeCardKey` 纯函数：去首尾/中间空白 + 大写，空串仍为空。

### 未验证项

- 真机从激活入口输入小写/带空格卡密是否已能激活，**未验**（依赖服务端 `db.get_card` 存的是大写）。
- 未对**非卡密类口令**做规范化：Pro 独立空间的 `passphrase` 仍保持原有 `trim`，
  避免误伤服务端下发的 `setup_passphrase`。

---

## 门禁输出（本分支本次运行）

命令与结果（在本 worktree 内执行；`node_modules` 通过 Junction 复用主 checkout 的安装）：

- `npx tsc --noEmit --skipLibCheck` → **0 error**（exit 0）
- `npm run lint` → **0 error / 9 warnings**（exit 0；9 条为 2.0.15 起既有的历史 warning，未新增）
- `npm run svelte-check` → **0 error / 0 warning**（exit 0）
- `npm run test:unit -- --pool=threads` → **147 个测试文件 / 1157 个用例全部通过**（exit 0）
- **未执行 `npm run build`**（按任务要求）

> 完整原始输出见提交附带的运行记录；本文件只记录结论。

---

## 未验证项汇总（必须如实对外）

1. **真机首启激活路径未验**：B2 的行为测试是 Node 替身级，不是真机。
   真机需按 `.obsidian/livesync-aiagent.json` **不存在**的全新安装，
   确认第一次点激活即发出 `POST https://api4.sacu3.cn/api/activate`。
2. **D4 的服务端真实 `detail` 未核对**：401/402/426 的实际响应体字段与文案以线上为准。
3. **服务端 Pro 路由缺失由另一方修复中**：本次未改服务端，插件侧无法独立消除该阻断项。
4. **未执行构建**：`main.js` 等发布资产未重建；本分支不 push、不动既有 tag/Release、不改 `main`。

---
