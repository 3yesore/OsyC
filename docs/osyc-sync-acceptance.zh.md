# OsyC 同步发布前端到端门禁（osyc-sync-acceptance）

> 适用对象：发版人 / 值班维护者
> 脚本：`scripts/osyc-sync-acceptance.mjs`
> npm 入口：`npm run test:acceptance:sync`
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
5. 用解析出的凭据对远端发**真实** `GET <endpoint>/<db>`，要求 200 且 `db_name` 匹配。

对应 15 项检查（全通过才 exit 0）：

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
| 12/13 | 等于 `--expect-db` / `--expect-endpoint` | 写到了错误的库/端点 |
| 14 | 远端 GET 返回 200 | 鉴权失败、库不存在、入口不可达 |
| 15 | 远端 `db_name` 匹配 | 200 了但不是这个库 |

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
| `--expect-db <db>` | 建议 | 期望 `couchDB_DBNAME` |
| `--expect-endpoint <url>` | 建议 | 期望 `couchDB_URI` |
| `--timeout-ms <n>` | 否 | 远端请求超时，默认 15000 |
| `--help` | 否 | 帮助 |

退出码：`0` 全部通过（或 SKIP）；`1` 有检查失败；`2` 用法错误。

---

## 3. 参数从哪来

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

## 4. 失败怎么读

输出形如：

```text
检查结果：
  [OK  ] 解码 setup URI — 解出 11 个键
  ...
  [FAIL] 远端 GET 返回 200 — HTTP 403
门禁未通过：1 项失败（共 15 项）。不要发布。
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

脚本从不打印 setup URI、卡密、CouchDB 口令的原文，只打印**长度**；用户名只打印掩码。

---

## 5. 与单元测试的关系

本门禁**不替代** `npm run test:unit`：

- 单元测试（`livesyncPatch.unit.spec.ts`、`livesyncPatch.remoteConfig.unit.spec.ts` 等）
  锁定纯函数行为，秒级、无需租户。
- 本门禁锁定「真实 setup URI + 真实远端」的端到端闭环，必须带租户凭据、会发网络请求。

发布前两者都要绿。

---

## 6. 运行环境

- Node **v24.13.1**（本机实测）。脚本直接 `import "../src/osyc/features/AIAgent/livesyncPatch.ts"`，
  依赖 Node 原生 TypeScript 类型擦除（Node ≥ 22.18 / ≥ 23.6 默认开启；更老的 Node 会报
  `Unknown file extension ".ts"`，请升级 Node）。
- 需要能访问公网同步入口（`--expect-endpoint` 对应的域名）。
- 不需要启动 Docker、Obsidian 或任何本地服务。

---

## 7. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-09-20 | 初版：为「静默成功」事故建立发布前自动门禁 |
