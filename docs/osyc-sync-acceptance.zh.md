# OsyC 同步发布前端到端门禁（osyc-sync-acceptance）

> 适用对象：发版人 / 值班维护者
> 脚本：`scripts/osyc-sync-acceptance.mjs`
> npm 入口：`npm run test:acceptance:sync`
> 覆盖链路：默认 CouchDB（`t_<uuid32>`）与 **Pro 独立同步空间**（`t_<uuid32>_pro`）。
> 离线自检：`npm run test:acceptance:sync:self-test`（不需要任何租户凭据）。
> 关联事故：2026-09-20「静默成功」——新设备卡密激活后插件报成功，但客户端没有
> 任何可用远端（`couchDB_*` 全空、`remoteConfigurations={}`、
> `activeConfigurationId=""`），用户一条笔记都读不到。

---

## 0. 硬要求（每次切版前必须跑）

**任何要对外发布的版本，打包后、发布前，必须用一条真实租户的 setup URI 完整跑一次本门禁，
并拿到 `门禁通过：N 项全部 OK` 与 `exit 0`。**

- **不带真实参数的 SKIP 不算通过。** 脚本在没有 `--setup-uri` 时会打印
  `SKIP ... exit 0`，那只是「本机没有租户凭据时不阻塞开发」，不能作为发布放行依据。
- 门禁失败一律**禁止发布**，先修代码或先修租户，再重跑。
- **默认与 Pro 两条链路都要各跑一次。** 只跑默认链路不能作为 Pro 独立同步空间
  （库名 `t_<uuid32>_pro`）的放行依据；Pro 链路的 setup URI 来自
  `tenant_pro_namespace.setup_uri`（即 `GET /api/pro/namespace` 的 `setup_uri`）。
- 门禁检查的是「发布的插件代码写出的远端拓扑」+「远端真的可读」，不是「后端脚本说成功」。
  2026-09-20 的事故正是后端/插件都报成功、设备端却无远端可用。

---

## 1. 它到底检查什么

脚本在 Node 里**原样复现设备激活时真正发生的那条写入链路**：

1. 用 commonlib 的 `decodeSettingsFromSetupURI` 解码 setup URI（解密口令就是卡密）；
2. 调 `buildSetupPatch` 生成合并补丁（含 `liveSync=true`、`remoteType=""`、
   `customChunkSize` 等）；
3. 调 `planCouchDbRemoteConfigurationReroute` 依据「写入前的设置」计算远程配置档案改写；
   —— 全新设备按 `DEFAULT_SETTINGS` 打底，正是 2026-09-20 出事的场景；
4. 用 `ConnectionStringParser` 反解析活动档案的 uri，确认它真的指向本次下发的目标；
5. 目标库名为 Pro 名（`t_<uuid32>_pro`）或显式 `--pro-namespace` 时，追加 Pro 命名与
   base/Pro 隔离断言；
6. 用解析出的凭据对远端发**真实** `GET <endpoint>/<db>`，要求 200 且 `db_name` 匹配。

对应检查项（全通过才 exit 0；数量随参数变化）：

| # | 检查项 | 失败意味着 |
|---|---|---|
| 1 | 解码 setup URI | 口令/卡密不对，或 URI 损坏 |
| 2 | 载荷含完整 CouchDB 身份 | setup URI 缺 `couchDB_URI/USER/PASSWORD/DBNAME` |
| 3 | `activeConfigurationId` 有值 | **2026-09-20 事故形态**：没有活动远端 |
| 4 | 活动档案存在 | activeConfigurationId 指向不存在的档案 |
| 5 | `liveSync` 已打开 | 复制器不会启动，笔记永远不上传 |
| 6 | `isConfigured` 已标记 | 配置态没落盘 |
| 7 | 档案 uri 解析为 couchdb | 档案写成了 S3/P2P 或坏 uri |
| 8 | 档案 `couchDB_DBNAME` 与载荷一致 | 顶层与档案不一致，下次启动会被覆盖 |
| 9 | 档案 `couchDB_URI` 与载荷一致 | 同上（端点漂移） |
| 10 | 顶层 `couchDB_*` 与档案一致 | 拓扑不一致 |
| 11 | 凭据长度（只打印长度/掩码） | 口令为空 |
| 12 | 载荷 `couchDB_DBNAME` 等于 `--expect-db` | setup URI 写到了错误的库 |
| 13 | **档案库名与 `--expect-db` 一致** | 档案把顶层覆盖回旧库（Pro↔base 串库的最贵形态） |
| 14 | `couchDB_URI` 等于 `--expect-endpoint` | 端点漂移 |
| 15 | 远端 GET 返回 200 | 鉴权失败、库不存在、入口不可达 |
| 16 | 远端 `db_name` 匹配 | 200 了但不是这个库 |

Pro 模式下再追加三项：

| # | 检查项 | 失败意味着 |
|---|---|---|
| 17 | Pro 库名符合 `t_<uuid32>_pro` | 参数/URI 不是 Pro 空间，或命名函数被改坏 |
| 18 | Pro 用户名与库名同租户（`osyc_sync_<同 uuid32>_pro`） | 库与用户不同租户，激活后连不上 |
| 19 | Pro 库名与 base 库名不同 | 分层隔离被破坏（Pro 写进了 base 库） |

> 12/13/14 仅在传了对应 `--expect-*` 参数时出现；17–19 仅在 Pro 模式下出现。
> 默认链路带 `--expect-db/--expect-endpoint` 共 16 项，Pro 链路共 19 项。

---

## 2. 怎么跑

```bash
# 方式 A：直接给参数（注意 shell 历史会记录口令，私密环境用）
node scripts/osyc-sync-acceptance.mjs \
  --setup-uri "<tenants.setup_uri>" \
  --passphrase "<卡密>" \
  --expect-db "<couchDB_DBNAME>" \
  --expect-endpoint "<couchDB_URI>" \
  --timeout-ms 15000

# 方式 B：从文件读（避免口令出现在进程参数/历史里）
node scripts/osyc-sync-acceptance.mjs \
  --setup-uri-file /path/to/setup-uri.txt \
  --passphrase-file /path/to/card-key.txt \
  --expect-db "<db>" --expect-endpoint "<endpoint>"

# 方式 C：环境变量
OSYC_SYNC_ACCEPTANCE_SETUP_URI="<uri>" OSYC_SYNC_ACCEPTANCE_PASSPHRASE="<卡密>" \
  node scripts/osyc-sync-acceptance.mjs --expect-db "<db>" --expect-endpoint "<endpoint>"

# npm 入口（参数要放在 -- 之后）
npm run test:acceptance:sync -- --setup-uri "<uri>" --passphrase "<卡密>" \
  --expect-db "<db>" --expect-endpoint "<endpoint>"
```

参数一览：

| 参数 | 必填 | 说明 |
|---|---|---|
| `--setup-uri <uri>` | 是（或文件/环境变量） | 租户 setup URI |
| `--setup-uri-file <path>` | 与上二选一 | 从文件读 URI（只剥行尾 CR/LF，**不 trim 尾部空格**） |
| `--passphrase <卡密>` | 给了 URI 就必填 | setup URI 解密口令 = 卡密 |
| `--passphrase-file <path>` | 与上二选一 | 从文件读口令（trim 首尾空白） |
| `--expect-db <db>` | 建议 | 期望 `couchDB_DBNAME`；形如 `t_<uuid32>_pro` 时自动开启 Pro 断言 |
| `--expect-endpoint <url>` | 建议 | 期望 `couchDB_URI` |
| `--timeout-ms <n>` | 否 | 远端请求超时，默认 15000 |
| `--pro-namespace`（别名 `--pro`） | 否 | 强制按 Pro 独立同步空间断言 |
| `--self-test` | 否 | 离线自检，不需要租户凭据、不发网络请求 |
| `--help` | 否 | 帮助 |

退出码：`0` 全部通过（或 SKIP / self-test 通过）；`1` 有检查失败；`2` 用法错误。

---

## 3. Pro 独立同步空间链路怎么跑

Pro 空间由 `/srv/osyc/current/scripts/pro_namespace.py` 开通，命名与 base 严格分层：

| | base | Pro |
|---|---|---|
| 库 | `t_<uuid32>` | `t_<uuid32>_pro` |
| 用户 | `osyc_sync_<uuid32>` | `osyc_sync_<uuid32>_pro` |
| setup URI 来源 | `tenants.setup_uri` | `tenant_pro_namespace.setup_uri`（即 `GET /api/pro/namespace` 的 `setup_uri`） |

Pro 的 setup URI 与默认链路走**同一个生成器**（`tools/gen_setup_uri.mjs`，强制加密），
所以门禁复用同一条解码 → 激活复现 → 真实 GET 链路；Pro 只是把目标库/用户换成 `_pro`
名字，并额外断言第 17–19 项。

```bash
# 目标库名形如 t_<uuid32>_pro 时自动进入 Pro 断言
node scripts/osyc-sync-acceptance.mjs \
  --setup-uri-file /path/to/pro-setup-uri.txt \
  --passphrase-file /path/to/card-key.txt \
  --expect-db "t_<uuid32>_pro" \
  --expect-endpoint "<couchDB_URI>"

# 也可以显式强制（例如先只跑 Pro 命名断言）
node scripts/osyc-sync-acceptance.mjs ... --pro-namespace

# npm 入口
npm run test:acceptance:sync -- --setup-uri-file ... --passphrase-file ... \
  --expect-db "t_<uuid32>_pro" --expect-endpoint "<couchDB_URI>"
```

取 Pro 参数（只读；**不要把结果打印或写进仓库**）：卡密仍取 `tenants.card_key`，
setup URI 取 `tenant_pro_namespace.setup_uri`，两者都只写进本地临时文件：

```bash
ssh osyc-prod "/srv/osyc/venv/bin/python - <<'PY'
import sys; sys.path.insert(0, '/srv/osyc/current')
from scripts.provision_couchdb_tenant import load_config
from app.db import Database
cfg = load_config('/etc/osyc/provisioner.json')
db = Database(str(cfg['db_path']))
t = db.get_tenant('<卡密>')
row = db.get_pro_namespace(t['tenant_uuid']) or {}
print(row.get('setup_uri') or '')   # 只重定向到临时文件，不回显
db.close()
PY
" > "$TMPDIR/pro-setup-uri.txt"

rm -f "$TMPDIR/pro-setup-uri.txt"   # 用完立刻删除
```

Pro 链路的负向证据（错误 `--expect-db` 必须 exit 1）：拿 Pro 的 setup URI，把
`--expect-db` 故意传成同一租户的 base 库 `t_<uuid32>`，应同时失败
「载荷 `couchDB_DBNAME` 等于 `--expect-db`」与「档案库名与 `--expect-db` 一致」，
进程 `exit 1`。脱敏后的实测输出见第 4 节。

---

## 4. 离线自检与负向用例

门禁自带一个不需要任何租户凭据的 self-test，用合成 uuid 验证「断言本身没坏」，
尤其是**错误 `--expect-db` 必须被判失败**：

```bash
npm run test:acceptance:sync:self-test
# 等价于：node scripts/osyc-sync-acceptance.mjs --self-test
```

它覆盖：

- Pro 正常链路 0 失败；
- `--expect-db` 传成 base 库 → 必须失败；
- 档案库名与 `--expect-db` 不一致 → 专项断言必须失败；
- `--pro-namespace` 遇到 base 库名 → 必须失败；
- Pro 用户名与库名不同租户 → 必须失败；
- base 库名不被误判为 Pro、Pro 库名能识别出同一 `uuid32`。

self-test 全 OK 时 `exit 0`；任一项不符 `exit 1`。它只证明断言逻辑正确，**不能**
替代带真实租户参数的门禁（真实链路仍必须跑第 2、3 节）。

带真实租户参数的负向用例（脱敏示例，库名以占位符表示）：

```text
# node scripts/osyc-sync-acceptance.mjs --setup-uri-file pro-uri.txt \
#   --passphrase-file card.txt --expect-db t_<uuid32>   # 故意传错：应为 base 库
链路：Pro 独立同步空间（t_<uuid32>_pro）
  [FAIL] 载荷 couchDB_DBNAME 等于 --expect-db — 载荷=t_<uuid32>_pro 期望=t_<uuid32>
  [FAIL] 档案库名与 --expect-db 一致 — 档案=t_<uuid32>_pro 期望=t_<uuid32>
门禁未通过：2 项失败（共 19 项）。不要发布。
# 进程 exit 1（实测）
```

---

## 5. 参数从哪来

真实参数只在生产服务器上取，**不要写进仓库、文档、聊天或日志**。

| 参数 | 来源 |
|---|---|
| `--setup-uri` | 生产库 `tenants.setup_uri`（SQLite，路径见 `/etc/osyc/provisioner.json` 的 `db_path`） |
| `--passphrase` | 同一行的 `tenants.card_key`（**卡密即解密钥匙**，provisioner 用卡密加密 setup URI） |
| `--expect-db` | 由租户 uuid 推出：`t_<uuid 去掉连字符>`（`provision_couchdb_tenant.database_name`） |
| `--expect-endpoint` | `/etc/osyc/provisioner.json` 的 `endpoint`（去掉尾部斜杠） |

安全取数示例（在本地机器执行，只把结果写进**临时文件**，不打印、用完即删）：

```bash
# 1) 到服务器把租户行拉到本地临时文件（不回显）
ssh osyc-prod "/srv/osyc/venv/bin/python - <<'PY'
import json, sys
sys.path.insert(0, '/srv/osyc/current')
from scripts.provision_couchdb_tenant import load_config, database_name
cfg = load_config('/etc/osyc/provisioner.json')
from app.db import Database
db = Database(str(cfg['db_path']))
uuid = '<TENANT_UUID>'
row = db._conn.execute(
    'SELECT card_key, setup_uri FROM tenants WHERE tenant_uuid=?', (uuid,)
).fetchone()
db.close()
print(json.dumps({
    'card_key': row[0],
    'setup_uri': row[1],
    'db': database_name(uuid),
    'endpoint': str(cfg['endpoint']).rstrip('/'),
}))
PY
" > "$TMPDIR/osyc-acc-tenant.json"

# 2) 读进环境变量后跑门禁（本步不打印任何敏感值）
export OSYC_SYNC_ACCEPTANCE_SETUP_URI="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["setup_uri"],end="")' "$TMPDIR/osyc-acc-tenant.json")"
export OSYC_SYNC_ACCEPTANCE_PASSPHRASE="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["card_key"],end="")' "$TMPDIR/osyc-acc-tenant.json")"
npm run test:acceptance:sync -- \
  --expect-db "$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["db"])' "$TMPDIR/osyc-acc-tenant.json")" \
  --expect-endpoint "$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["endpoint"])' "$TMPDIR/osyc-acc-tenant.json")"

# 3) 立刻删除临时文件，并清理环境变量
rm -f "$TMPDIR/osyc-acc-tenant.json"
unset OSYC_SYNC_ACCEPTANCE_SETUP_URI OSYC_SYNC_ACCEPTANCE_PASSPHRASE
```

> 选租户建议：优先选最近开通、`remote_type='couchdb'`、`setup_uri` 非空的租户；
> 不要拿已知故障租户（例如历史事故里 `doc_count=1`、只剩版本标记文档的租户）当「通过」样本。

---

## 6. 失败怎么读

输出形如：

```text
检查结果：
  [OK  ] 解码 setup URI — 解出 11 个键
  ...
  [FAIL] 远端 GET 返回 200 — HTTP 403
门禁未通过：1 项失败（共 16 项）。不要发布。
```

常见失败与定位：

| 失败项 | 常见原因 | 处理 |
|---|---|---|
| 解码 setup URI = false | 口令不是卡密 / URI 被截断 | 重新取 `tenants.card_key` 与完整 `setup_uri` |
| `activeConfigurationId 有值` FAIL | `planCouchDbRemoteConfigurationReroute` 回归或载荷不完整 | 检查 `livesyncPatch.ts` 与 setup URI 字段 |
| 档案 uri 解析为 couchdb FAIL | 目标被序列化成 S3/P2P | 检查 `remoteType` 与合并设置 |
| 远端 GET HTTP 403 | 鉴权失败，或没带可识别 UA（Cloudflare 拦截） | 脚本已带设备 UA；重点查凭据/库的 `_security` |
| 远端 GET HTTP 404 | 库不存在 / 库名不对 | 核对 `database_name(uuid)` 与 `tenants.remote_type` |
| 远端 GET fetch failed | DNS/TLS/网络不可达 | 在能访问公网入口的机器上重跑 |
| 远端 db_name 不匹配 | 端点指向了错误的库 | 核对 `--expect-endpoint` 与租户行 |
| 档案库名与 `--expect-db` 一致 FAIL | 设备档案把顶层覆盖回旧库（Pro↔base 串库） | 检查 `planCouchDbRemoteConfigurationReroute` 与档案改写 |
| Pro 库名符合 `t_<uuid32>_pro` FAIL | 参数/URI 不是 Pro 空间，或命名函数回归 | 核对 `pro_namespace.py` 命名与 Pro setup URI |
| Pro 用户名与库名同租户 FAIL | 库与用户不是同一租户 | 重新开通 Pro 空间，核对 `_pro` 用户名 |
| Pro 库名与 base 库名不同 FAIL | 分层隔离被破坏 | **立即停止发布**，检查 Pro 开通是否误用 base 名 |

脚本从不打印 setup URI、卡密、CouchDB 口令的原文，只打印**长度**；用户名只打印掩码。

---

## 7. 与单元测试的关系

本门禁**不替代** `npm run test:unit`：

- 单元测试（`livesyncPatch.unit.spec.ts`、`livesyncPatch.remoteConfig.unit.spec.ts` 等）
  锁定纯函数行为，秒级、无需租户。
- 本门禁锁定「真实 setup URI + 真实远端」的端到端闭环，必须带租户凭据、会发网络请求。

发布前两者都要绿。

---

## 8. 运行环境

- Node **v24.13.1**（本机实测）。脚本直接 `import "../src/osyc/features/AIAgent/livesyncPatch.ts"`，
  依赖 Node 原生 TypeScript 类型擦除（Node ≥ 22.18 / ≥ 23.6 默认开启；更老的 Node 会报
  `Unknown file extension ".ts"`，请升级 Node）。
- 需要能访问公网同步入口（`--expect-endpoint` 对应的域名）。
- 不需要启动 Docker、Obsidian 或任何本地服务。

---

## 9. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-09-20 | 初版：为「静默成功」事故建立发布前自动门禁 |
| 2026-09-20 | 增加 Pro 独立同步空间链路（`t_<uuid32>_pro`）断言、档案库名与 `--expect-db` 不一致的专项失败，以及离线 `--self-test` 负向用例 |
