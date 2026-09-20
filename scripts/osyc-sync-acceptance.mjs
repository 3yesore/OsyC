#!/usr/bin/env node
/**
 * OsyC 发布前端到端门禁：setup URI -> 激活写入 -> 远端真实可达。
 *
 * ## 为什么需要它（2026-09-20「静默成功」事故）
 *
 * 新设备输入卡密激活后，插件报成功，但客户端 data.json 里
 * `couchDB_* ` 全空、`remoteConfigurations={}`、`activeConfigurationId=""` ——
 * 用户一条笔记都读不到，排查耗时很久。
 *
 * 原因不是「激活失败」，而是「激活成功但没写出任何可用远端」：
 * setup_uri 的载荷只含身份类字段，不含 `liveSync` / `remoteType` / 档案拓扑，
 * 只做浅合并（applyPartial）不会碰 `remoteConfigurations`。
 * 修复由 `src/osyc/features/AIAgent/livesyncPatch.ts` 的
 * `buildSetupPatch` + `planCouchDbRemoteConfigurationReroute` 承担。
 *
 * 本脚本把「设备上真正发生的那条写入链路」在 Node 里原样复现一遍，再去远端
 * 发一个**真实** GET，确保发布出去的东西真的能读。任何一环断了都 exit 1。
 *
 * ## 为什么是 .mjs 而不是 vitest 用例
 *
 * 本机 Node（v24）能原生 strip TS 类型，直接 import `livesyncPatch.ts` 即可；
 * 无需 vitest 的转换层，也就能直接吃 `--setup-uri` 这类自定义参数（vitest CLI
 * 会拒绝未知选项）。所以按「node 能直跑 TS」的分支实现为独立脚本。
 *
 * ## 用法（详见 docs/osyc-sync-acceptance.zh.md）
 *
 *   node scripts/osyc-sync-acceptance.mjs --setup-uri "<uri>" --passphrase "<卡密>" \
 *        [--expect-db <db>] [--expect-endpoint <https://...>] [--timeout-ms 15000] \
 *        [--pro-namespace]
 *
 * 也可以从文件 / 环境变量取（避免口令出现在进程参数里）：
 *   --setup-uri-file <path>  --passphrase-file <path>
 *   OSYC_SYNC_ACCEPTANCE_SETUP_URI / OSYC_SYNC_ACCEPTANCE_PASSPHRASE
 *
 * ## 两条链路都要覆盖
 *
 * - **默认 CouchDB 激活链路**：库名 `t_<uuid32>`。
 * - **Pro 独立同步空间链路**（由 /srv/osyc/current/scripts/pro_namespace.py 开通）：
 *   库名 `t_<uuid32>_pro`、用户名 `osyc_sync_<uuid32>_pro`，setup URI 与默认链路
 *   走同一个生成器，所以这里复用同一条解码 → 激活复现 → 真实 GET 链路，额外断言
 *   Pro 命名与 base/Pro 隔离。只要 --expect-db 形如 `t_..._pro`（或目标库名是 Pro 名），
 *   Pro 断言自动开启；--pro-namespace 可显式强制。
 *
 * 没给 setup URI 时打印 SKIP 并 exit 0（本地/CI 无租户凭据时不阻塞）；
 * 检查失败 exit 1；用法错误 exit 2。
 * --self-test 不需要任何租户凭据，离线跑命名/期望值断言的负向用例（用于 CI 与本地回归）。
 *
 * ## 安全约束（硬要求）
 *
 * - **绝不打印口令 / 卡密 / 完整 setup URI**，只打印长度。
 * - **绝不把上述内容写进仓库**：本脚本只读参数，不落盘。
 */

import { readFileSync } from "node:fs";
import process from "node:process";

import { decodeSettingsFromSetupURI } from "@vrtmrz/livesync-commonlib/compat/API/processSetting";
import { DEFAULT_SETTINGS } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { ConnectionStringParser } from "@vrtmrz/livesync-commonlib/compat/common/ConnectionString";
import {
    buildSetupPatch,
    planCouchDbRemoteConfigurationReroute,
} from "../src/osyc/features/AIAgent/livesyncPatch.ts";

/**
 * 公网同步入口在 Cloudflare 后面，没有可识别 UA 的请求会被规则拦成 403
 * （与设备无关）。这里用与 `scripts/audit_tenant_sync.py` 相同的设备 UA。
 */
const DEVICE_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

/**
 * 命名规则是服务端 app/pro_namespace.py 的唯一实现，这里只做**只读识别**：
 *   base: db t_<uuid32>          user osyc_sync_<uuid32>
 *   pro:  db t_<uuid32>_pro      user osyc_sync_<uuid32>_pro
 * <uuid32> = 租户 UUID 去掉横线后的 32 位小写十六进制。门禁绝不改写任何名字。
 */
const UUID32 = "[0-9a-f]{32}";
const PRO_DB_RE = new RegExp(`^t_(${UUID32})_pro$`);
const BASE_DB_RE = new RegExp(`^t_(${UUID32})$`);
const PRO_USER_SUFFIX = "_pro";
const USER_PREFIX = "osyc_sync_";

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

/** 已执行的检查项，逐项打印；任一项失败最终 exit 1。 */
const checks = [];

function ok(name, detail = "") {
    checks.push({ name, ok: true, detail });
}

function fail(name, detail = "") {
    checks.push({ name, ok: false, detail });
}

function parseArgs(argv) {
    const options = {
        setupUri: process.env.OSYC_SYNC_ACCEPTANCE_SETUP_URI ?? "",
        setupUriFile: "",
        passphrase: process.env.OSYC_SYNC_ACCEPTANCE_PASSPHRASE ?? "",
        passphraseFile: "",
        expectDb: "",
        expectEndpoint: "",
        timeoutMs: 15000,
        proNamespace: false,
        selfTest: false,
        help: false,
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        const value = () => {
            const next = argv[i + 1];
            if (next === undefined) throw new Error(`参数 ${arg} 缺少取值`);
            i += 1;
            return next;
        };
        switch (arg) {
            case "--setup-uri":
                options.setupUri = value();
                break;
            case "--setup-uri-file":
                options.setupUriFile = value();
                break;
            case "--passphrase":
                options.passphrase = value();
                break;
            case "--passphrase-file":
                options.passphraseFile = value();
                break;
            case "--expect-db":
                options.expectDb = value();
                break;
            case "--expect-endpoint":
                options.expectEndpoint = value();
                break;
            case "--timeout-ms":
                options.timeoutMs = Number(value());
                break;
            case "--pro-namespace":
            case "--pro":
                options.proNamespace = true;
                break;
            case "--self-test":
                options.selfTest = true;
                break;
            case "--help":
            case "-h":
                options.help = true;
                break;
            default:
                throw new Error(`未知参数：${arg}`);
        }
    }
    return options;
}

function readSecretFile(path) {
    // 文件里通常会带一个换行：只剥掉行尾 CR/LF。
    // setup URI 由 commonlib 编码时**末尾带一个空格**，那个空格不能动 ——
    // 所以这里不能直接 trim()，否则会改写后端下发的原始字符串。
    return readFileSync(path, "utf8").replace(/[\r\n]+$/, "");
}

/** 口令文件按普通文本 trim：卡密本身不含首尾空白。 */
function readPassphraseFile(path) {
    return readFileSync(path, "utf8").trim();
}

const stripTrailingSlash = (value) => String(value ?? "").replace(/\/+$/, "");

/** 只暴露长度或掩码，绝不回显口令本身。 */
function maskUser(user) {
    const text = String(user ?? "");
    if (text.length <= 6) return "***";
    return `${text.slice(0, 6)}…${text.slice(-3)}`;
}

/** Pro 层库名识别：t_<uuid32>_pro。命中返回 {uuid32, database, user}，否则 null。 */
function matchProDatabaseName(name) {
    const text = String(name ?? "");
    const matched = text.match(PRO_DB_RE);
    if (!matched) return null;
    return { uuid32: matched[1], database: text, user: USER_PREFIX + matched[1] + PRO_USER_SUFFIX };
}

/** base 层库名识别：t_<uuid32>。 */
function matchBaseDatabaseName(name) {
    const text = String(name ?? "");
    const matched = text.match(BASE_DB_RE);
    return matched ? { uuid32: matched[1], database: text, user: USER_PREFIX + matched[1] } : null;
}

/**
 * 「载荷/档案库名 与 --expect-db」断言。返回检查项数组，由调用方统一打印。
 *
 * 档案库名单独断言，而不是只比「档案 ?? 载荷」：Pro 链路最贵的故障形态就是
 * 「setup URI 指向 _pro，但设备上已存在的档案把顶层 couchDB_* 覆盖回 base」——
 * 只比一个合并值会漏掉档案与 --expect-db 的偏差。
 */
function evaluateExpectDbChecks({ decodedDb, profileDb, expectDb }) {
    const out = [];
    if (!expectDb) return out;
    const payloadOk = String(decodedDb ?? "") === expectDb;
    out.push({
        name: "载荷 couchDB_DBNAME 等于 --expect-db",
        ok: payloadOk,
        detail: payloadOk ? expectDb : "载荷=" + String(decodedDb) + " 期望=" + expectDb,
    });
    if (profileDb !== undefined && profileDb !== null && profileDb !== "") {
        const profileOk = String(profileDb) === expectDb;
        out.push({
            name: "档案库名与 --expect-db 一致",
            ok: profileOk,
            detail: profileOk ? expectDb : "档案=" + String(profileDb) + " 期望=" + expectDb,
        });
    }
    return out;
}

/**
 * Pro 独立同步空间断言（proMode 为真时全部必须通过）：
 *   1. 目标库名符合 t_<uuid32>_pro；
 *   2. 用户名与库名派生自同一个 uuid32（osyc_sync_<uuid32>_pro）；
 *   3. Pro 库名不得等于同一租户的 base 库名（分层隔离）。
 * 只做只读识别，绝不改写任何名字。
 */
function evaluateProChecks({ targetDb, user, proMode }) {
    const out = [];
    if (!proMode) return out;
    const pro = matchProDatabaseName(targetDb);
    out.push({
        name: "Pro 库名符合 t_<uuid32>_pro",
        ok: Boolean(pro),
        detail: pro ? String(targetDb) : "实际=" + String(targetDb),
    });
    if (pro) {
        const userOk = String(user ?? "") === pro.user;
        out.push({
            name: "Pro 用户名与库名同租户",
            ok: userOk,
            detail: userOk ? "osyc_sync_<同 uuid32>_pro" : "实际=" + maskUser(user) + " 期望=osyc_sync_<同 uuid32>_pro",
        });
        const isolated = String(targetDb) !== "t_" + pro.uuid32;
        out.push({
            name: "Pro 库名与 base 库名不同",
            ok: isolated,
            detail: isolated ? "base 库未被占用" : "Pro 与 base 同名",
        });
    }
    return out;
}

/**
 * 离线 self-test：不碰网络、不需要任何租户凭据，用合成 uuid 验证命名识别与
 * 期望值断言的**负向**行为 —— 故意传错的 --expect-db 必须被判失败。
 * 这是本门禁的「断言本身没坏」证据，CI 与本地回归都可直接跑。
 */
function runSelfTest() {
    const uuid = "0".repeat(32); // 合成值：不是任何真实租户
    const baseDb = "t_" + uuid;
    const proDb = "t_" + uuid + "_pro";
    const baseUser = USER_PREFIX + uuid;
    const proUser = USER_PREFIX + uuid + "_pro";
    const results = [];

    const failing = (items) => items.filter((item) => !item.ok).length;
    const record = (name, expected, actual) => {
        results.push({ name, ok: expected === actual, expected, actual });
    };

    // 正向：Pro 链路一切匹配 → 0 个失败。
    record(
        "Pro 正常链路 0 失败",
        0,
        failing([
            ...evaluateExpectDbChecks({ decodedDb: proDb, profileDb: proDb, expectDb: proDb }),
            ...evaluateProChecks({ targetDb: proDb, user: proUser, proMode: true }),
        ])
    );
    // 负向 1：故意把 --expect-db 传成 base 库 → 必须失败。
    record(
        "错误 --expect-db（base 库）必须有失败",
        true,
        failing([
            ...evaluateExpectDbChecks({ decodedDb: proDb, profileDb: proDb, expectDb: baseDb }),
            ...evaluateProChecks({ targetDb: proDb, user: proUser, proMode: true }),
        ]) > 0
    );
    // 负向 2：档案库名与 --expect-db 不一致 → 专项断言必须失败。
    record(
        "档案库名与 --expect-db 不一致必须失败",
        true,
        evaluateExpectDbChecks({ decodedDb: proDb, profileDb: baseDb, expectDb: proDb }).some(
            (item) => !item.ok && item.name === "档案库名与 --expect-db 一致"
        )
    );
    // 负向 3：--pro-namespace 模式下目标却是 base 库 → 必须失败。
    record(
        "Pro 模式遇到 base 库名必须有失败",
        true,
        failing(evaluateProChecks({ targetDb: baseDb, user: baseUser, proMode: true })) > 0
    );
    // 负向 4：Pro 用户名与库名不同租户 → 必须失败。
    record(
        "Pro 用户名与库名不同租户必须有失败",
        true,
        failing(evaluateProChecks({ targetDb: proDb, user: baseUser, proMode: true })) > 0
    );
    // 命名识别：base 库名不得被当成 Pro。
    record("base 库名不被识别为 Pro", null, matchProDatabaseName(baseDb));
    record("base 库名识别出 uuid32", uuid, matchBaseDatabaseName(baseDb)?.uuid32 ?? null);
    record("Pro 库名识别出同一 uuid32", uuid, matchProDatabaseName(proDb)?.uuid32 ?? null);

    console.log("self-test（离线，无租户凭据）：");
    for (const item of results) {
        const mark = item.ok ? "OK  " : "FAIL";
        console.log("  [" + mark + "] " + item.name);
    }
    const failed = results.filter((item) => !item.ok);
    console.log("");
    if (failed.length > 0) {
        console.error("self-test 未通过：" + failed.length + " 项（共 " + results.length + " 项）。");
        return EXIT_FAILED;
    }
    console.log("self-test 通过：" + results.length + " 项全部 OK。");
    return EXIT_OK;
}

function printHelp() {
    console.log(`OsyC 同步端到端验收门禁

用法：
  node scripts/osyc-sync-acceptance.mjs --setup-uri <uri> --passphrase <卡密>
       [--expect-db <db>] [--expect-endpoint <https://...>] [--timeout-ms 15000]
       [--pro-namespace]

参数：
  --setup-uri <uri>        租户 setup URI（来自服务器 tenants.setup_uri）
  --setup-uri-file <path>  从文件读取 setup URI（避免出现在进程参数里）
  --passphrase <卡密>      setup URI 的解密口令（就是激活用的卡密）
  --passphrase-file <path> 从文件读取口令
  --expect-db <db>         期望的 couchDB_DBNAME（可选）
                           形如 t_<uuid32>_pro 时自动启用 Pro 链路断言
  --expect-endpoint <url>  期望的 couchDB_URI（可选）
  --timeout-ms <n>         远端请求超时，默认 15000
  --pro-namespace          强制按 Pro 独立同步空间断言（t_<uuid32>_pro）
  --self-test              离线自检命名/期望值断言，不需要租户凭据

环境变量：OSYC_SYNC_ACCEPTANCE_SETUP_URI / OSYC_SYNC_ACCEPTANCE_PASSPHRASE
未提供 setup URI 时打印 SKIP 并 exit 0。`);
}

/**
 * 复现「设备激活时真正写下去的那份设置」。
 *
 * 与 `useAIAgentUI.ts:agent.applySetupUri` 的分支完全一致：
 *   1. decodeSettingsFromSetupURI 解出后端载荷；
 *   2. buildSetupPatch 生成合并补丁（含 liveSync / remoteType / customChunkSize）；
 *   3. planCouchDbRemoteConfigurationReroute 依据「写入前的设置」计算档案改写；
 *   4. applyPartial 是浅合并 —— 所以结果就是 {...prior, ...patch, ...reroute}。
 *
 * 现场按「全新设备」复现：prior = DEFAULT_SETTINGS。
 * 这也正是 2026-09-20 出事的场景（新 vault，没有任何既有档案）。
 */
function reproduceActivation(decoded) {
    const prior = { ...DEFAULT_SETTINGS };
    const patch = buildSetupPatch(decoded);
    const reroute = planCouchDbRemoteConfigurationReroute(decoded, prior);
    const settings = { ...prior, ...patch };
    if (reroute.changed) {
        settings.remoteConfigurations = reroute.remoteConfigurations;
        settings.activeConfigurationId = reroute.activeConfigurationId;
    }
    return { prior, patch, reroute, settings };
}

async function main() {
    let options;
    try {
        options = parseArgs(process.argv.slice(2));
    } catch (error) {
        console.error(`用法错误：${error.message}`);
        return EXIT_USAGE;
    }
    if (options.help) {
        printHelp();
        return EXIT_OK;
    }
    if (options.selfTest) {
        // 离线自检在任何租户凭据之前返回，CI 不需要 setup URI。
        return runSelfTest();
    }
    if (options.setupUriFile) options.setupUri = readSecretFile(options.setupUriFile);
    if (options.passphraseFile) options.passphrase = readPassphraseFile(options.passphraseFile);

    if (!options.setupUri) {
        console.log("SKIP: 未提供 --setup-uri（或 OSYC_SYNC_ACCEPTANCE_SETUP_URI）。");
        console.log("      这是「无租户凭据时不阻塞」的降级行为，不构成发布放行依据。");
        console.log("      发布前必须带真实租户参数再跑一次（见 docs/osyc-sync-acceptance.zh.md）。");
        return EXIT_OK;
    }
    if (!options.passphrase) {
        console.error("用法错误：提供了 setup URI 但没有解密口令（--passphrase / --passphrase-file）。");
        return EXIT_USAGE;
    }
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
        console.error("用法错误：--timeout-ms 必须是正数。");
        return EXIT_USAGE;
    }

    // 这一段只打印长度：setup URI 与口令都是敏感值。
    console.log("OsyC 同步端到端验收门禁");
    console.log(`  setup URI 长度：${options.setupUri.length}`);
    console.log(`  口令长度：${options.passphrase.length}`);
    console.log("");

    // ---- 1. 解码 setup URI ------------------------------------------------
    let decoded = false;
    let decodeError = null;
    try {
        decoded = await decodeSettingsFromSetupURI(options.setupUri, options.passphrase);
    } catch (error) {
        decodeError = error;
    }
    if (!decoded) {
        // 只报一次：异常优先，其次才是「返回 false」。
        fail(
            "解码 setup URI",
            decodeError
                ? `异常：${decodeError.name}: ${decodeError.message}`
                : "decodeSettingsFromSetupURI 返回 false（口令不对或 URI 损坏）"
        );
        return report();
    }
    ok("解码 setup URI", `解出 ${Object.keys(decoded).length} 个键`);

    // 载荷完整性：CouchDB 身份四件套必须齐全，否则激活写不出可用远端。
    const requiredKeys = ["couchDB_URI", "couchDB_USER", "couchDB_PASSWORD", "couchDB_DBNAME"];
    const missing = requiredKeys.filter((key) => !String(decoded[key] ?? "").trim());
    if (missing.length > 0) {
        fail("载荷含完整 CouchDB 身份", `缺少：${missing.join(", ")}`);
    } else {
        ok("载荷含完整 CouchDB 身份", requiredKeys.join(", "));
    }

    // ---- 2. 复现激活写入 --------------------------------------------------
    const { settings, reroute } = reproduceActivation(decoded);

    if (settings.activeConfigurationId) {
        ok("activeConfigurationId 有值", settings.activeConfigurationId);
    } else {
        fail("activeConfigurationId 有值", '为空 —— 这正是 2026-09-20 事故的形态');
    }

    const profile = settings.activeConfigurationId
        ? settings.remoteConfigurations?.[settings.activeConfigurationId]
        : undefined;
    if (profile) {
        ok("活动档案存在", `remoteConfigurations["${settings.activeConfigurationId}"]`);
    } else {
        fail("活动档案存在", "activeConfigurationId 指向的档案不存在（远端不可读）");
    }

    if (settings.liveSync === true) {
        ok("liveSync 已打开", "复制器会启动");
    } else {
        fail("liveSync 已打开", `实际为 ${String(settings.liveSync)}`);
    }
    if (settings.isConfigured === true) {
        ok("isConfigured 已标记", "true");
    } else {
        fail("isConfigured 已标记", `实际为 ${String(settings.isConfigured)}`);
    }

    let parsed = null;
    if (profile && typeof profile.uri === "string") {
        try {
            parsed = ConnectionStringParser.parse(profile.uri);
        } catch (error) {
            fail("档案 uri 可解析", `解析异常：${error.message}`);
        }
        if (parsed && parsed.type !== "couchdb") {
            fail("档案 uri 解析为 couchdb", `实际 type=${parsed.type}`);
            parsed = null;
        } else if (parsed) {
            ok("档案 uri 解析为 couchdb", "type=couchdb");
        }
    } else if (profile) {
        fail("档案 uri 可解析", "档案 uri 不是字符串");
    }

    const resolved = parsed?.settings ?? null;
    if (resolved) {
        // 解析出的档案值必须与本次下发的目标逐字一致。
        const sameDb = resolved.couchDB_DBNAME === decoded.couchDB_DBNAME;
        const sameEndpoint = stripTrailingSlash(resolved.couchDB_URI) === stripTrailingSlash(decoded.couchDB_URI);
        if (sameDb) {
            ok("档案 couchDB_DBNAME 与载荷一致", String(resolved.couchDB_DBNAME));
        } else {
            fail("档案 couchDB_DBNAME 与载荷一致", `档案=${resolved.couchDB_DBNAME} 载荷=${decoded.couchDB_DBNAME}`);
        }
        if (sameEndpoint) {
            ok("档案 couchDB_URI 与载荷一致", stripTrailingSlash(resolved.couchDB_URI));
        } else {
            fail("档案 couchDB_URI 与载荷一致", `档案=${stripTrailingSlash(resolved.couchDB_URI)} 载荷=${stripTrailingSlash(decoded.couchDB_URI)}`);
        }

        // 顶层字段也必须指向同一目标：LiveSync 在某些路径直接读顶层。
        const topDb = settings.couchDB_DBNAME;
        const topEndpoint = stripTrailingSlash(settings.couchDB_URI);
        if (topDb === decoded.couchDB_DBNAME && topEndpoint === stripTrailingSlash(decoded.couchDB_URI)) {
            ok("顶层 couchDB_* 与档案一致", "拓扑一致");
        } else {
            fail("顶层 couchDB_* 与档案一致", `顶层=${topEndpoint}/${topDb} 档案=${stripTrailingSlash(resolved.couchDB_URI)}/${resolved.couchDB_DBNAME}`);
        }
        ok("凭据长度", `user=${maskUser(resolved.couchDB_USER)} password长度=${String(resolved.couchDB_PASSWORD ?? "").length}`);
    }

    // ---- 期望值断言（--expect-db / --expect-endpoint）与 Pro 链路断言 -----
    const targetDb = resolved?.couchDB_DBNAME ?? decoded.couchDB_DBNAME;
    const targetEndpoint = stripTrailingSlash(resolved?.couchDB_URI ?? decoded.couchDB_URI);

    // 目标库名是 Pro 名（或显式 --pro-namespace / --expect-db 指向 Pro 名）时自动
    // 开启 Pro 断言；这样「参数指向 Pro 库」与「--pro-namespace」两种用法都能覆盖。
    const proMode =
        options.proNamespace === true ||
        matchProDatabaseName(options.expectDb) !== null ||
        matchProDatabaseName(targetDb) !== null;
    console.log(`链路：${proMode ? "Pro 独立同步空间（t_<uuid32>_pro）" : "默认 CouchDB（t_<uuid32>）"}`);

    // 载荷库名与档案库名分别对 --expect-db 断言：故意传错必须在这里失败。
    for (const item of evaluateExpectDbChecks({
        decodedDb: decoded.couchDB_DBNAME,
        profileDb: resolved?.couchDB_DBNAME,
        expectDb: options.expectDb,
    })) {
        checks.push(item);
    }

    // Pro 命名 / 同租户用户名 / 与 base 隔离（非 Pro 链路自动跳过）。
    for (const item of evaluateProChecks({
        targetDb,
        user: resolved?.couchDB_USER ?? decoded.couchDB_USER,
        proMode,
    })) {
        checks.push(item);
    }

    if (options.expectEndpoint) {
        if (targetEndpoint === stripTrailingSlash(options.expectEndpoint)) {
            ok("couchDB_URI 等于 --expect-endpoint", targetEndpoint);
        } else {
            fail("couchDB_URI 等于 --expect-endpoint", `实际=${targetEndpoint} 期望=${stripTrailingSlash(options.expectEndpoint)}`);
        }
    }

    // ---- 3. 对远端发真实请求 ---------------------------------------------
    if (!resolved || !targetEndpoint || !targetDb) {
        fail("远端 GET", "缺少可用的端点/库名，跳过真实请求");
    } else {
        const user = String(resolved.couchDB_USER ?? "");
        const password = String(resolved.couchDB_PASSWORD ?? "");
        const url = `${targetEndpoint}/${encodeURIComponent(targetDb)}`;
        try {
            const response = await fetch(url, {
                method: "GET",
                headers: {
                    Authorization: `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`,
                    Accept: "application/json",
                    "User-Agent": DEVICE_UA,
                },
                signal: AbortSignal.timeout(options.timeoutMs),
            });
            if (response.status !== 200) {
                fail("远端 GET 返回 200", `HTTP ${response.status}`);
            } else {
                const body = await response.json().catch(() => null);
                if (body && body.db_name === targetDb) {
                    ok("远端 GET 返回 200", `${url}（doc_count=${body.doc_count}）`);
                    ok("远端 db_name 匹配", body.db_name);
                } else if (body) {
                    fail("远端 db_name 匹配", `实际=${body.db_name} 期望=${targetDb}`);
                } else {
                    fail("远端 JSON 可解析", "200 但响应不是合法 JSON");
                }
            }
        } catch (error) {
            const reason = error.name === "TimeoutError" ? `超时（>${options.timeoutMs}ms）` : `${error.name}: ${error.message}`;
            fail("远端 GET 返回 200", reason);
        }
    }

    return report();
}

function report() {
    console.log("检查结果：");
    for (const check of checks) {
        const mark = check.ok ? "OK  " : "FAIL";
        console.log(`  [${mark}] ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
    }
    const failures = checks.filter((check) => !check.ok);
    console.log("");
    if (failures.length > 0) {
        console.error(`门禁未通过：${failures.length} 项失败（共 ${checks.length} 项）。不要发布。`);
        return EXIT_FAILED;
    }
    console.log(`门禁通过：${checks.length} 项全部 OK。可以发布。`);
    return EXIT_OK;
}

main()
    .then((code) => {
        process.exitCode = code;
    })
    .catch((error) => {
        // 兜底：绝不回显参数原文，只报类型与消息。
        console.error(`未预期错误：${error?.name}: ${error?.message}`);
        process.exitCode = EXIT_FAILED;
    });
