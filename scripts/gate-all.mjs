#!/usr/bin/env node
/**
 * OsyC 切版前一键门禁（gate-all）。
 *
 * ## 为什么需要它
 *
 * 2026-09-16 起，发布收口清单把类型检查、lint、svelte-check、apps 类型检查、
 * 全量单测与同步自检都补成了必跑项，但它们散落在清单的多个小节里，靠人逐条
 * 复制粘贴。2.0.16 / 2.0.17 两次切版都出现过「漏跑其中一项，等 CI 或用户才发现」。
 * 本脚本把这六项固定成一条命令，按顺序跑完，逐项打印 PASS/FAIL；任一项失败
 * 立即以非零退出，后续项不再执行（避免带着已知失败继续切版）。
 *
 * ## 六项（顺序固定）
 *
 *   1. tsc --noEmit --skipLibCheck
 *   2. lint
 *   3. svelte-check
 *   4. tsc-check:apps
 *   5. test:unit -- --pool=threads   （本机必须是 threads 池：forks 池会被当前
 *      执行环境的进程管理强杀，表现为整批用例莫名中断）
 *   6. test:acceptance:sync:self-test
 *
 * 不包含 build、指纹计算与真实租户链路门禁：那几项见
 * docs/RELEASE-CLOSURE-CHECKLIST.zh.md 第 2、3、4.2、4.3 节。
 *
 * ## 用法
 *
 *   node scripts/gate-all.mjs          # 跑全部六项
 *   node scripts/gate-all.mjs --list   # 只列出门禁项，不执行
 *   sh scripts/gate-all.sh             # 等价入口（Git Bash / WSL / Linux）
 *
 * 退出码：全绿 0；任一项失败 1；环境问题（Node 版本、缺依赖）2。
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const NPM = isWindows ? "npm.cmd" : "npm";
const TSC_BIN = path.join(repoRoot, "node_modules", "typescript", "bin", "tsc");

const MIN_NODE = [22, 18];

/** 六项门禁：name 用于打印，cmd 是 [可执行文件, ...参数]。 */
const steps = [
  {
    name: "tsc --noEmit --skipLibCheck",
    cmd: [process.execPath, TSC_BIN, "--noEmit", "--skipLibCheck"],
  },
  { name: "lint", cmd: [NPM, "run", "lint"] },
  { name: "svelte-check", cmd: [NPM, "run", "svelte-check"] },
  { name: "tsc-check:apps", cmd: [NPM, "run", "tsc-check:apps"] },
  { name: "test:unit -- --pool=threads", cmd: [NPM, "run", "test:unit", "--", "--pool=threads"] },
  { name: "test:acceptance:sync:self-test", cmd: [NPM, "run", "test:acceptance:sync:self-test"] },
];

function shellQuote(value) {
  if (isWindows) return /[\s"]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
  return /[^\w@%+=:,./-]/.test(value) ? "'" + value.replace(/'/g, "'\\''") + "'" : value;
}

function nodeTooOld() {
  const current = process.versions.node.split(".").map(Number);
  const minMajor = MIN_NODE[0];
  const minMinor = MIN_NODE[1];
  return current[0] < minMajor || (current[0] === minMajor && current[1] < minMinor);
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log("用法: node scripts/gate-all.mjs [--list]");
  process.exit(0);
}
if (args.includes("--list")) {
  steps.forEach(function (step, index) {
    console.log((index + 1) + ". " + step.name);
  });
  process.exit(0);
}

console.log("=== OsyC 切版前一键门禁（gate-all）===");
console.log("仓库   ：" + repoRoot);
console.log("Node   ：" + process.version + "（要求 >= " + MIN_NODE.join(".") + "）");
console.log("平台   ：" + process.platform + " " + process.arch);
console.log("");

if (nodeTooOld()) {
  console.error("FAIL：Node " + process.version + " 低于要求的 " + MIN_NODE.join(".") + "，请先升级。");
  process.exit(2);
}
if (!existsSync(TSC_BIN)) {
  console.error("FAIL：找不到 " + TSC_BIN + "，请先在仓库根目录执行 npm install / npm ci。");
  process.exit(2);
}

const results = [];
for (let i = 0; i < steps.length; i++) {
  const step = steps[i];
  const label = "[" + (i + 1) + "/" + steps.length + "] " + step.name;
  const commandLine = step.cmd.map(shellQuote).join(" ");
  console.log("--- " + label + " ---");
  console.log("$ " + commandLine);
  const startedAt = Date.now();
  const result = spawnSync(commandLine, { cwd: repoRoot, stdio: "inherit", shell: true });
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  const code = result.status === null ? "null" : String(result.status);
  if (result.error) {
    console.log(label + " FAIL（" + seconds + "s，启动失败：" + result.error.message + "）");
    results.push({ label: label, passed: false });
    console.error("\n门禁失败：" + step.name + "。立即停止，未执行：" + (steps.slice(i + 1).map(function (s) { return s.name; }).join("、") || "（无）"));
    process.exit(1);
  }
  if (result.status !== 0) {
    console.log(label + " FAIL（exit=" + code + "，" + seconds + "s）");
    results.push({ label: label, passed: false });
    console.error("\n门禁失败：" + step.name + "（exit=" + code + "）。立即停止，未执行：" + (steps.slice(i + 1).map(function (s) { return s.name; }).join("、") || "（无）"));
    process.exit(1);
  }
  console.log(label + " PASS（" + seconds + "s）\n");
  results.push({ label: label, passed: true });
}

console.log("=== gate-all 汇总 ===");
for (const result of results) console.log((result.passed ? "PASS" : "FAIL") + "  " + result.label);
console.log("\n全部通过：" + results.length + "/" + steps.length + " PASS。");
process.exit(0);
