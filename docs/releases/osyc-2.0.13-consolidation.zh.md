# 2.0.13 交接与整理（2026-09-20）

一份给"下一个接手的人/agent"的状态快照：2.0.13 切在哪、门禁跑过什么、谁写哪些文件、
以及**如果发布结果不是含本分支提交的 2.0.13，那要怎么并成 2.0.14**。

## 1. 现状快照

| 项目 | 值 |
| --- | --- |
| 本地分支 | `release/2.0.13`（远端无此分支，未推送） |
| 重切提交 | `2ec9368` release(osyc): cut 2.0.13 with email sign-in and the recharge entry |
| 指纹提交 | `3379d6f` release(osyc): record the re-cut 2.0.13 asset fingerprints and source commit |
| `origin/main` | `b7fd1e3`（记录 2.0.12 发布，未推进） |
| 最新 GitHub Release | 2.0.12（`/releases/tag/2.0.12`） |
| 台账候选 | `docs/releases/release-ledger.json` → candidate 2.0.13 `status: reserved`（无 tag），`sourceCommit/assetSourceCommit: 2ec9368` |
| 资产指纹 | main.js `10c9563ae4eb1e465c1399523e3efe5356701922d87881a8cde7965d02dc48e0`；manifest.json / manifest-beta.json `a3af3f53…`；styles.css `63af2cd2…`；versions.json `c319d88e…` |
| 本次门禁 | `tsc --noEmit` 0 error；eslint 0 error；release-contract 4/4；unit **137 文件 / 1027 用例全绿**；`npm run build` 成功 |
| 设备验收 | `pending-desktop`（需要真机 Obsidian 点一次"发送验证码 → 登录"） |

本次并入 2.0.13 的内容：账户弹窗的**充值积分入口**、**邮箱登录 + 绑定卡密**（会话 token 授权，
替代原禁用预览）、**品牌统一**（仓库根 `OsyC-logo.png` + `assets/brand/` 派生图 + 署名只留 `OsyC`）、
审核图标白名单补验 `link / log-in / plus-circle / send`。

## 2. 发布归属

`release-ledger.json` 的 `publicationRules` 明确：`singleWriter: release-captain`、
`featureAgentsMayPublish: false`。因此本分支**只切不发**，也不推 `main`。
发布动作 = 把 `main` fast-forward 到评审提交，触发 `.github/workflows/publish-release-assets.yml`
创建正式（非 pre-release）Release。

## 3. 发布之后的两条路径

### 路径 A：release-captain 用含 `2ec9368` 的提交推进 main

2.0.13 就是含邮箱+充值的版本，**不需要 2.0.14**。整理动作：

1. 用 `release-info.json` 的五个指纹核对线上 Release 资产（逐字节）；
2. 台账把 candidate 2.0.13 提升为 `currentStable`，原 `currentStable`(2.0.11) 落 `previousStable`，
   2.0.12 记录保留在 `previousCandidate`，并在 `notes` 追加"2.0.13 已发布、发布于 <时间>、
   `GET /releases/latest` 解析到 2.0.13"；
3. 预留下一个候选（2.0.14）时再新建 `release/2.0.14` 分支，不动本次提交。

### 路径 B：release-captain 用**不含**本分支提交的方式发布了 2.0.13

我的三个提交（`2ec9368` / `3379d6f`，以及 9d7cbf0 之后的台账行）要重挂到 **2.0.14**：

```bash
git fetch origin
git switch -c release/2.0.14 origin/main          # 从已发布的 main 起
git cherry-pick 2ec9368                            # 冲突点：main.js / updates.md / ledger
# 版本号五处：package.json, manifest.json, manifest-beta.json, versions.json(新增 "2.0.14": "1.7.2"),
#             updates.md(把 2.0.13 段落改写成 2.0.14 段落)
npm run tsc-check && npx vitest run --config vitest.config.unit.ts && npm run build
# 重新指纹 → release-info.json（sourceCommit/version/5 个 hash）
# 台账：candidate.version=2.0.14, sourceBranch=release/2.0.14, sourceCommit=<新的切版提交>
git commit -m "release(osyc): cut 2.0.14 with email sign-in and the recharge entry"
```

注意：`updates.md` 的 2.0.13 段落若已被 2.0.13 发布占用，不要改写历史，改为在 `## Unreleased`
下新增 `## 2.0.14` 段落；`versions.json` 只新增条目、不改旧条目。

## 4. 文件所有权（避免多 agent 撞车）

| 文件 | 本次写入者 |
| --- | --- |
| `src/osyc/features/AIAgent/AIAgentAccountModal.ts`、`CmdAIAgent.ts`、两个 spec | OsyC 账户/邮箱工作流 |
| `src/osyc/features/AIAgent/reviewHygiene.unit.spec.ts`（图标白名单） | 同上 |
| `README.md`（顶部 logo）、`updates.md`（2.0.13 段落）、`release-info.json` | 同上 |
| `docs/releases/release-ledger.json` 的 candidate 行 | 同上（**currentStable 提升属 release-captain**） |
| `src/osyc/features/AIAgent/livesyncPatch.ts`、`src/osyc/serviceFeatures/useAIAgentUI.ts` | LiveSync/激活工作流 |
| `main.js`、`manifest*.json`、`versions.json` | 每次切版由切版方统一重建，不并行改 |

同一时刻一个文件只有一个写入者；切版前先 `git status`，发现别人未提交的同名文件就让路。

## 5. 后端配套（与插件同批上线，已实测）

服务端改动直接落在生产 release 目录：`app/mailer.py`、`app/email_auth.py`、`app/db.py`
（新增 `account_sessions`）、`app/api/routes.py`（`/api/email/send-code`、`/api/email/verify`、
`/api/account/bind-email`、`/api/account/bind-card`）、`app/config.py`。
一次性快照与重放说明在服务器 `/srv/osyc/patches/email-auth-20260920/`（含 `sha256sums.txt` 与
`safe_patch` 驱动）。**下次切后端 release 后要确认这 5 个文件仍在**，否则按快照重放。

## 6. 仍未完成

- 设备验收：真机 Obsidian「发送验证码 → 登录 → 绑定卡密」全流程点击验证；
- `/api/sync/now`、公告邮件、冲突处理 UI、多设备 LiveSync 验收（`Learning-Vault`）；
- 凭据轮换：QQ 授权码与 `ADMIN_TOKEN` 都曾出现在会话输出里；
- 桌面侧 `osyc-tools/fix-dsh-windowshide.ps1`（DSH 弹窗补丁）需重启 DSH 后确认生效。

## 7. 正式服务地址核对（2026-09-20 实测）

| 用途 | 地址 | 证据 |
| --- | --- | --- |
| 后端 API | `https://api4.sacu3.cn` | DNS A → 106.55.1.124；HTTPS `/health` 200（TLS 校验通过、TLS1.3）；`/api/runtime-info` 200；`POST /api/activate`（无效卡密）401；HTTP → 302 跳 HTTPS；nginx vhost 反代 `http://osyc_api`（127.0.0.1:8124） |
| LiveSync 同步 | `https://osyc3.sacu3.cn` | DNS A → 106.55.1.124；根路径 401（CouchDB 要求鉴权，符合预期）；nginx vhost 反代 `http://osyc_couchdb`（127.0.0.1:5984） |
| 证书 | `/etc/ssl/osyc/fullchain.pem` | Let's Encrypt，**SAN = api4.sacu3.cn, osyc3.sacu3.cn**（CN 只是 osyc3）；有效期至 2026-12-17；`osyc-acme-renew.timer` 下次 2026-09-21 03:58 续期 |
| 插件预置 | `src/osyc/features/AIAgent/serviceDefaults.ts` | `DEFAULT_SERVICE_URL = "https://api4.sacu3.cn"`；`LEGACY_OFFICIAL_SERVICE_URLS = ["https://api.sacu3.cn", "https://osyctest.sacu3.cn"]` |
| 服务端签发 | `/etc/osyc/provisioner.json` | `endpoint = https://osyc3.sacu3.cn`、`couchdb.uri = http://127.0.0.1:5984`，即下发给客户端的 setup URI 里的同步入口 |

结论：插件默认地址与生产入口一致，客户端 API 走 `api4`、同步走 `osyc3`，两者同机（106.55.1.124）同一张证书。
历史入口 `api.sacu3.cn`（CF 隧道）与 `osyctest.sacu3.cn` 目前仍返回 200，插件只把它们当**历史值迁移**来源，新安装一律落到 `api4`。
可选清理项：确认没有客户端还在用后，把 `osyctest.sacu3.cn`（以及 CF 隧道那条）在 DNS/nginx 上退役，减少长期暴露面。

## 8. 已就绪但尚未并入的修复：移动端首启激活卡

分支 `fix/mobile-activation-keyboard`（基于本分支 `1ad7176`）提交 `af81337`：

- 首启欢迎区改为**账户可用后**才渲染：原来它渲染在激活卡上方，且两块各带一份 12vh 外边距，手机上一点卡密输入框弹出的键盘就把激活框盖住；
- 激活卡吸收了原欢迎区文案，移动端 `margin-top: 3vh`，未激活时时间线留 `padding-bottom: max(38vh, 200px)` 键盘余量；
- 卡密输入框补 `autocomplete=off`、不自动大写、不走拼写检查、`enterkeyhint=go`，回车即激活；
- 仍遵守既有回归约束：不引入 `scrollIntoView` 整页滚动，不在 pane 里用 `window.visualViewport`；
- 门禁：svelte-check 0 error / 0 warning；unit 137 文件 / 1031 用例全绿。

**并入时必须补做一步**：该提交没有重建 `main.js`（提交时工作区还有其它 agent 的未提交改动，不能在脏树上出构建产物）。
合并到任一发布分支后，要在**干净工作区**执行 `npm run build`，再重算五个资产指纹并同步 `release-info.json` 与台账的 `sourceCommit/assetSourceCommit`。
