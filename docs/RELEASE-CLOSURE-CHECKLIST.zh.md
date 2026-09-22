# 切版前收口清单（OsyC 插件）

> 适用对象：准备切版/发布 OsyC 插件的执行者（feature agent）。
> 发布权归 `release-captain`：本清单执行到「交给 release-captain」为止，
> **不要**自行推送 `main`、打 tag 或创建 Release（`docs/releases/release-ledger.json` 的
> `publicationRules.featureAgentsMayPublish=false`）。
> 关联文档：`docs/osyc-sync-acceptance.zh.md`、`docs/releases/README.md`、
> `docs/releases/release-ledger.json`。

**总原则：任何一步失败或无法确认，立即停下，修好再从头跑；不得跳步，
不得在脏工作区执行 `npm run build`。**

---

## 切版前硬门禁（不可跳过）

**切版前必须在仓库根目录跑 `node scripts/gate-all.mjs`（等价 `sh scripts/gate-all.sh`），
六项全绿（打印 `6/6 PASS` 且 exit 0）才允许继续后面的构建与切版。任一 FAIL 立即停止，
修好再从头跑；不得跳过、不得只挑其中几项。**

门禁覆盖（顺序固定，即 2.0.16 起补进发布清单的六项）：

1. `tsc --noEmit --skipLibCheck`
2. `npm run lint`
3. `npm run svelte-check`
4. `npm run tsc-check:apps`
5. `npm run test:unit -- --pool=threads`（本机必须 threads 池：forks 池会被执行环境强杀）
6. `npm run test:acceptance:sync:self-test`

`node scripts/gate-all.mjs --list` 只列项不执行。该脚本只跑这六项；`build`、五个资产指纹
与真实租户链路门禁见第 2、3、4.2、4.3 节。

---

## 0. 一次性准备（新开 shell 时）

- [ ] `git rev-parse --show-toplevel` —— 确认在插件仓库根目录。
- [ ] `node -v` —— 门禁脚本要求 Node ≥ 22.18 / ≥ 23.6（2.0.13 实测 v24.13.1）。
- [ ] `git branch --show-current`；并核对 `docs/releases/release-ledger.json` 的
      `candidate.version` 就是本次要发布的版本号。

## 1. 干净工作区确认（失败即停）

- [ ] `git status --porcelain=v1`
- [ ] `git fetch origin` 后 `git log --oneline -1 origin/main`
- [ ] 判定规则：
  - 输出必须**为空**；若有改动，必须全部是你本次发布**自己拥有**的文件。
  - 出现他人未提交的改动（例如 `src/osyc/features/AIAgent/livesyncPatch.unit.spec.ts`、
    `main.js`、`src/common/messages*` 等）→ **停下**，联系对应负责人，不要继续。
- [ ] `git rev-parse HEAD` 记下当前提交，下文记作 `<cut-commit>`。
- [ ] **禁止**在工作区不干净时执行第 2 步：`npm run build` 会重写 `main.js`，
      把他人未提交的构建产物混进你的切版。

通过标准：`git status --porcelain=v1` 为空（或只含你的文件），且没有他人未提交文件。

## 2. 构建（失败即停）

- [ ] `npm run build`
- [ ] 通过标准：命令 `exit 0`，`main.js` 已按当前源码重建。
- 失败即停：构建报错先修代码；不得沿用上一次的构建产物。

## 3. 重算五个资产指纹并更新 release-info.json（失败即停）

五个版本化资产：`main.js`、`manifest.json`、`manifest-beta.json`、`styles.css`、`versions.json`。

- [ ] 版本号五处对齐：`package.json`、`manifest.json`、`manifest-beta.json`、
      `versions.json`（新增条目）、`updates.md`（版本段落），且 `main.js` 内注入的版本号相同。
- [ ] 计算 SHA-256（PowerShell）：
      `'main.js','manifest.json','manifest-beta.json','styles.css','versions.json' | ForEach-Object { "$_  $((Get-FileHash $_ -Algorithm SHA256).Hash.ToLower())" }`
- [ ] 计算 SHA-256（bash / CI）：
      `sha256sum main.js manifest.json manifest-beta.json styles.css versions.json`
- [ ] 把 `version`、`sourceCommit`（= `<cut-commit>`）与五个 hash 写入 `release-info.json`。
- [ ] 复核：`git diff -- release-info.json` 只应反映本轮的 `version` / `sourceCommit` / 五个 hash。
- 失败即停：任一 hash 与 `release-info.json` 不一致、或版本号五处不一致，修好后重跑第 2、3 步。

> 仓库内没有自动生成/校验 `release-info.json` 的脚本，这一步是人工维护，
> 也是历史上该文件漂移的原因 —— 必须逐字节核对。

## 4. 门禁（全绿才继续；任一失败即停）

> 其中 `tsc --noEmit --skipLibCheck`、`lint`、`svelte-check`、`tsc-check:apps`、
> 全量单测与同步自检六项，已由「切版前硬门禁」的 `scripts/gate-all.mjs` 一次跑完；
> 下面保留逐项说明，供单独复跑或排查时参考。

### 4.1 类型检查 + 单元测试全量

- [ ] `npm run tsc-check`
- [ ] `npx vitest run --config vitest.config.unit.ts`
- [ ] 通过标准：tsc 0 error；vitest 全绿，并记录「文件数 / 用例数」
      （2.0.13 的基线是 137 文件 / 1027 用例）。
- 失败即停。

> 更广的卫生门禁 `npm run check`（tsc-apps + lint + svelte-check + iOS 15 兼容）
> 建议一并跑；它与本三项不冲突。

### 4.2 本门禁（默认 CouchDB 链路，带真实租户参数）

- [ ] 先跑离线自检确认断言没坏：`npm run test:acceptance:sync:self-test` → 期望 `exit 0`。
- [ ] 带真实租户参数：
      `npm run test:acceptance:sync -- --setup-uri-file <uri文件> --passphrase-file <卡密文件> --expect-db t_<uuid32> --expect-endpoint <endpoint>`
- [ ] 通过标准：打印 `门禁通过：16 项全部 OK` 且 `exit 0`；**SKIP 不算通过**。
- [ ] 参数只在本地临时文件流转，用完即删；**不得**写进仓库 / 日志 / 聊天
      （见 `docs/osyc-sync-acceptance.zh.md` 第 5 节）。
- 失败即停。

### 4.3 Pro 独立同步空间链路用例

- [ ] 取 Pro 空间的 `tenant_pro_namespace.setup_uri`（只写临时文件，不回显）。
- [ ] `npm run test:acceptance:sync -- --setup-uri-file <pro-uri文件> --passphrase-file <卡密文件> --expect-db t_<uuid32>_pro --expect-endpoint <endpoint>`
      → 期望 `门禁通过：19 项全部 OK` 且 `exit 0`（自动进入 Pro 断言）。
- [ ] 负向：同一条 Pro setup URI，故意 `--expect-db t_<uuid32>`（同一租户的 base 库）
      → 必须 `exit 1`，且失败项包含「档案库名与 `--expect-db` 一致」。
- 失败即停。

## 5. 台账更新（失败即停）

- [ ] 打开 `docs/releases/release-ledger.json`，更新 `candidate`：
      `version`、`channel`、`sourceBranch`、`sourceCommit` / `assetSourceCommit` = `<cut-commit>`。
      `currentStable` 的提升**留给 release-captain**。
- [ ] `release-info.json` 的 `version` / `sourceCommit` 与台账 `candidate` 一致。
- [ ] `node utils/verify-osyc-collaboration.mjs`（如需校验 ref，再带 `--check-refs`）
      → 期望 `OsyC collaboration state aligned`。
- 失败即停。

## 6. 交给 release-captain（不要自行发布）

- [ ] 提交切版与指纹：再次 `git status` 确认只剩你拥有的改动后提交，记下提交号。
- [ ] 把证据整理成一条交接消息发给 `release-captain`：
  - 分支、`candidate` 版本、`<cut-commit>`（以及之后的指纹提交）；
  - `release-info.json` 的五个 hash；
  - tsc / vitest 结果（文件数、用例数）；
  - 默认链路门禁与 Pro 链路门禁的 exit code 与检查项数（16 / 19）；
  - 负向用例的 exit code（必须为 1）；
  - 已知未验证项（例如 `candidate.deviceAcceptance` 仍为 `pending-desktop`）。
- [ ] **不要**推送 `main`、**不要**打 tag、**不要**创建或修改 GitHub Release。
      发布动作由 `release-captain` 以 fast-forward 推送 `main` 触发
      `.github/workflows/publish-release-assets.yml`。
- 失败即停：证据不齐或任一门禁未过，不得移交发布。

## 7. 切版后核对（release-captain 侧，本清单仅引用）

- [ ] 线上 Release 的三个资产（`main.js`、`manifest.json`、`styles.css`）与
      `release-info.json` 逐字节一致。
- [ ] `GET /releases/latest` 解析到本次版本，且 Release 为 `prerelease=false`。
- [ ] 台账把 `currentStable` 提升为本次版本，旧稳定版落 `previousStable`，
      并在 `notes` 记录发布时间与 `latest` 解析结果。

---

## 变更记录

| 日期 | 变更 |
|---|---|
| 2026-09-20 | 初版：按「干净工作区 → build → 指纹 → 三门禁 → 台账 → 交接」固化切版前收口清单 |
| 2026-09-22 | 新增 `scripts/gate-all.mjs` / `scripts/gate-all.sh` 一键门禁，并把「切版前必须跑 gate-all（六项全绿）」写成硬要求 |
