# OsyC 诊断与日志（2.0.17）

这篇文档说明 OsyC 插件在出问题时**到底会记什么、上传什么、卖家去哪看**。

2.0.16 及以前有两个现场问题，2.0.17 一并修掉：

1. **日志里通常只有一条**（服务端运行时指纹 INFO）。原因是健康路径上几乎所有流程
   都只走 `console.*` 或干脆不记；`osycLogger` 的 200 条缓冲因此恒定只有那一条。
   缓冲本身没有 bug，也没有被清空——是**没人往里写**。
2. **日志上传形同摆设**。失败任务卡片上传时，`diagnostics_log` 被截到 600 字符，
   载荷里也没有账户、LiveSync、API 失败等现场信息；工具中心里更**没有上传入口**。

---

## 一、诊断包含什么

上传的载荷分四块（字段名为服务端契约）：

| 分块 | 字段 | 内容 |
| --- | --- | --- |
| 基本环境 | `plugin_version` / `obsidian_version` / `platform` | 插件版本、Obsidian 版本、平台（desktop / android / ios） |
| 账户 | `account_summary` | 当前档位（base / member / pro）、是否已激活、登录方式（card / email / none）、**掩码后**的邮箱 |
| LiveSync | `livesync_summary` | 活动档案名、远端端点**域名**、远端类型、协议版本、本机设备 ID 前 8 位、本机是否在远端 `accepted_nodes`、最近拉取/推送时间、关键设置指纹 |
| 运行时 | `runtime_info` | 服务端下发的运行时指纹（backend_release_id、hermes_adapter_version、artifact_intent_policy_version、streaming_protocol_version、plugin_compatibility） |
| 日志 | `diagnostics_log` | 最近日志缓冲的文本，上限 8000 字符（服务端允许 12000） |
| API 失败 | `api_failures` | 最近 20 条失败的「时间 + 请求路径 + 状态码」 |
| 失败任务 | 任务相关字段 | 任务 id、错误码、错误摘要、状态、最近 12 条进度事件；**任务描述与模型回复只记字数，不记正文** |

**关键设置指纹**（LiveSync 能不能对同一个远端握手，就看这几个 must-match 参数）：

- `customChunkSize`
- `hashAlg`
- `chunkSplitterVersion`
- `remoteType`

它们全是非敏感配置，可以安全上传。

## 二、诊断不包含什么

以下内容**永不进入日志、也永不进入上传载荷**：

- 卡密 / 卡密原文 / 卡密的任何片段；
- 设备 token、邮箱会话 token、任何 `Authorization` 值；
- 口令、`passphrase`、API key、`sk-` / `pk-` / `spt_` 开头的密钥；
- **完整 setup URI**（只留一个 `[REDACTED_SETUP_URI]` 占位符）；
- Vault 正文、文件名、附件内容；
- 远端连接串里的用户名、密码、库名（端点只保留「协议 + 域名(:端口)」）；
- 完整邮箱地址（只留 `a***@e***.com` 形式）；
- Windows / Unix 绝对路径；
- 模型回复正文与任务描述正文（只记录字数）。

## 三、隐私与掩码规则

掩码在**两端各做一遍**，任一端漏掉都不至于外泄。

### 插件侧

统一入口 `redactSensitiveText()`（`src/osyc/serviceFeatures/osycLogger.ts`）：

| 命中 | 替换为 |
| --- | --- |
| `obsidian://...` / `osyc://...` 的 setup URI | `[REDACTED_SETUP_URI]` |
| `authorization / password / passphrase / token / card_key / secret ...` 的 `key: value` 或 `key=value` | `[REDACTED]` |
| `Bearer <token>` | `Bearer [REDACTED]` |
| `sk-...` / `pk-...` / `spt_...` | `[REDACTED_KEY]` |
| URL 查询串里的凭据（`?token=...`） | `?token=[REDACTED]` |
| 邮箱地址 | `a***@e***.com` |

另外：

- 远端端点走 `maskEndpoint()`，只保留协议 + 域名(:端口)，丢弃 `user:pass@`、路径与查询串；
- 本机设备 ID 只上传前 8 位；
- `accepted_nodes` 只上传「本机是否在其中」的布尔值，不上传节点清单。

### 服务端侧

`POST /api/error-reports` 会再做一次校验（`app/api/routes.py`）：

- 命中敏感规则或绝对路径 → 整单 **422**，不入库；
- 校验前先剥掉客户端已经写好的「键名 + `[REDACTED]`」整对。这一条是 2.0.17 修复：
  旧逻辑只字面扫描，会把 `token=[REDACTED]` 这种**已经脱敏**的文本当成敏感数据拒收，
  诊断上传因此整个失败；
- 同时修掉 `https://` 被误判成 Windows 盘符路径（`s:/`）的误杀；
- 通过校验后，载荷用 AES-GCM 加密再落库（密钥 `ERROR_REPORT_ENCRYPTION_KEY`），
  数据库里存的是密文。

## 四、日志在哪些流程会记

健康路径也会留痕；下表每条都在 2.0.17 加入（或原有）：

| 流程 | 记录内容 | 位置 |
| --- | --- | --- |
| 启动自愈 | 本次实际修补项（补开 LiveSync 开关 / 纠正 customChunkSize） | `useAIAgentUI` |
| 激活 | 开始、成功（档位 / 是否自动配置同步 / provisioning 状态）、失败（状态码 + 服务端 detail） | `CmdAIAgent.activate` |
| setup URI | 应用开始、解码失败、**回读自检失败（含原因）**、应用成功（活动档案 / 端点 / 远端类型）、异常 | `useAIAgentUI.applySetupUri` |
| 同步 pull / push | 开始、完成、失败（中文原因），并记录时间供诊断摘要 | `useAIAgentUI.runOneWayReplication` |
| 加入远端里程碑 | 成功 | `useAIAgentUI` |
| API 4xx / 5xx | 每条：请求路径 + 状态码（日志一条 + 失败摘要缓冲一条） | `CmdAIAgent.apiRequest` |
| Pro 独立空间 | 开通开始、回读自检失败、已切换 | `CmdAIAgent.requestProNamespace` |
| 邮箱 | 验证码发送成功/失败、登录成功/失败、卡密并入邮箱成功/失败、卡密绑定邮箱成功/失败 | `CmdAIAgent` 各邮箱方法 |
| 端点半自动切换 | 切换前后端点、网络失败、可重试状态 | `CmdAIAgent.apiRequest` |
| 其他异常 | 未捕获 window 错误 / 未处理 Promise、页面挂载/打开失败、字体挂载失败、结果写入失败、设置/主题应用失败 | 各调用点 |

每条日志只记必要信息，不记敏感值。

## 五、日志缓冲与导出

- 日志是**进程内 ring buffer，最多 200 条**，不写笔记库；Obsidian 重启后清空。
- 打开：命令面板 →「打开日志」，或 设置 → OsyC → 诊断 → 打开日志。
- 复制纯日志：日志窗口「复制日志」；命令面板「复制脱敏诊断报告」（含环境 + 日志）；
  设置 → 诊断 → 复制报告；工具中心 → 调试 → 复制 OsyC 日志。
- 诊断报告文本以 `OsyC diagnostic log` 开头，第二行是 `entries=<当前缓冲条数>`；
  缓冲不再被 600 字符截断（上传时按 8000 字符截断）。

## 六、怎么上传

入口有两个，都不会自动上传，必须用户点击：

1. **工具中心 → 调试 → 上传脱敏诊断**（2.0.17 新增；此前工具中心没有上传入口）。
2. **失败任务卡片 / 助手消息上的「上传脱敏诊断」**（任务失败、冲突、投递失败、取消时出现）。

点击后会先弹确认框，然后向 `{服务地址}/api/error-reports` 发一个 POST：

- 认证：当前设备 token 的 `Authorization: Bearer`；
- 幂等：`Idempotency-Key` 用载荷里的 `request_id`，重试不会产生重复记录；
- 响应：`{"report_id": "err_...", "received_at": ..., "status": "received"}`，
  界面提示「诊断已上传，报告编号 err_xxx」。

## 七、上传后操作侧怎么查看

报告落在服务端 SQLite 的 `error_reports` 表：

| 列 | 说明 |
| --- | --- |
| `report_id` | 主键，`err_` 开头，即回执编号 |
| `request_id` | 客户端载荷里的请求 id，用于幂等 |
| `card_key` | 提交所属卡密（列内是明文，仅服务端库内可见；脚本只显示前 8 位） |
| `payload_json` | AES-GCM 密文载荷 |
| `created_at` | 落库时间（Unix 秒） |

报告保留 30 天（每次上报时机会性清理过期行）。

### 方式一：运维脚本（推荐，能看明文）

```bash
# 列最近 20 条编号（不打印正文）
/srv/osyc/venv/bin/python scripts/read_error_report.py --list 20

# 按回执编号读回并打印明文 JSON
/srv/osyc/venv/bin/python scripts/read_error_report.py err_XXXXXXXX

# 显式指定数据库与密钥（默认读 DB_PATH / ERROR_REPORT_ENCRYPTION_KEY）
/srv/osyc/venv/bin/python scripts/read_error_report.py err_XXXXXXXX \
    --db /srv/osyc/shared/data/backend.db --key "$ERROR_REPORT_ENCRYPTION_KEY"
```

脚本是**只读**的：不存在任何按 id 读诊断的 HTTP 接口，避免买家的档位与路径诊断被任意
token 直接读走。

### 方式二：纯 SQL（只定位，不解密）

```bash
sqlite3 /srv/osyc/shared/data/backend.db \
  "SELECT report_id, request_id, substr(card_key,1,8)||'...' AS card_prefix, \
          datetime(created_at,'unixepoch','localtime') AS created \
     FROM error_reports ORDER BY created_at DESC LIMIT 20;"
```

要读正文必须用脚本（或按同样的 AES-GCM 方式自行解密，AAD 为 `osyc-error-report-v1`，
密钥为 `sha256(ERROR_REPORT_ENCRYPTION_KEY)`）。

## 八、2.0.17 变更点

- 新增账户档位 / LiveSync 摘要 / API 失败摘要三类载荷字段，旧客户端不传也兼容；
- `diagnostics_log` 上限从 600 → 8000 字符；
- 关键流程补日志（见第四节），日志缓冲可累积多条并整体导出；
- 工具中心新增「上传脱敏诊断」入口；
- 服务端：`error_reports` 增加按 `report_id` 读回方法 + 运维脚本；
- 服务端：修复「已脱敏文本被误判敏感」与「`https://` 被误判盘符路径」两处误杀。
