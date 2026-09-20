/**
 * @file i18nPlaceholderContract.unit.spec.ts
 * @description 占位符契约哨兵 —— 防止"译文缺少 ${...} 占位符"这类缺陷再次溜到用户面前。
 *
 * 契约来源（谁传参）：
 *   node_modules/@vrtmrz/livesync-commonlib/dist/common/configForDoc.js
 *     translate("Doctor.Dialogue.Main",    { activateReason, issues })
 *     translate("Doctor.Dialogue.MainFix", { name, current, ideal, level, reason, note })
 *     translate("Doctor.Dialogue.TitleFix",{ current, total })
 *   以及全目录所有含 ${...} 的键（en 为基准）。
 *
 * 为什么必须是一条测试：
 *   插值实现 `$msg()`（src/common/translation.ts）只做 /\$\{placeholder\}/g 替换。
 *   译文里把 ${x} 写成 {x} 或裸 x，都不会报错、不会告警 —— 用户直接看到缺值或裸词。
 *   `_tools/checkI18nCoverage.ts` 只统计"缺键 / 与英文相同"，**不看占位符**，
 *   所以这 49 处缺陷（ru 42 / zh 4 / es 3）此前一路无人拦截。
 *
 * 读取的是权威源 src/common/messagesYAML/*.yaml（messagesJson 是它的生成物）。
 *
 * 收缩式基线：
 *   BASELINE 记录"已知且尚未修复"的违规。它**只能变小**：
 *   - 出现基线外的新违规 -> 测试失败（阻止回归）；
 *   - 违规总数超过基线长度 -> 测试失败；
 *   - 修好一条后，请把对应行从 BASELINE 删除（否则下一条注释会提醒你）。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { objectToDotted } from "./messagelib";

const MESSAGES_DIR = path.resolve(import.meta.dirname, "../src/common/messagesYAML");
const BASE_LOCALE = "en";
const PLACEHOLDER = /\$\{([A-Za-z0-9_]+)\}/g;

/**
 * 已知违规（locale, key）。这些译文**内容缺失**（不只是占位符），
 * 需要重译后才能补回占位符，见 osyc-ops 的评审记录。
 */
const BASELINE: ReadonlyArray<readonly [string, string]> = [
    ["ru", "moduleCheckRemoteSize.msgDatabaseGrowing"],
    ["ru", "moduleMigration.fix0256.message"],
    ["ru", "moduleMigration.fix0256.messageUnrecoverable"],
    ["ru", "moduleMigration.msgSinceV02321"],
    ["ru", "obsidianLiveSyncSettingTab.msgRebuildRequired"],
    ["ru", "TweakMismatchResolve.Message.Main"],
    ["ru", "TweakMismatchResolve.Message.MainTweakResolving"],
];

type Catalogue = Record<string, string>;

function loadCatalogue(fileName: string): Catalogue {
    const parsed: unknown = parse(readFileSync(path.join(MESSAGES_DIR, fileName), "utf-8"));
    return Object.fromEntries(
        Object.entries(objectToDotted(parsed ?? {}))
            .map(([key, value]) => [key.endsWith("._value") ? key.slice(0, -7) : key, value] as const)
            .filter(([, value]) => typeof value === "string") as Array<readonly [string, string]>
    );
}

const catalogues = new Map<string, Catalogue>(
    readdirSync(MESSAGES_DIR)
        .filter((f) => f.endsWith(".yaml"))
        .sort()
        .map((f) => [f.replace(/\.yaml$/, ""), loadCatalogue(f)])
);

interface Violation {
    locale: string;
    key: string;
    missing: string[];
    /** 被写成裸词的占位符（比"缺占位符"更严重：会原样显示给用户） */
    naked: string[];
}

const base = catalogues.get(BASE_LOCALE);
if (base === undefined) throw new Error(`${BASE_LOCALE}.yaml not found`);

const violations: Violation[] = [];
for (const [key, baseText] of Object.entries(base)) {
    const required = [...new Set([...baseText.matchAll(PLACEHOLDER)].map((m) => m[1]))];
    if (required.length === 0) continue;
    for (const [locale, catalogue] of catalogues) {
        if (locale === BASE_LOCALE) continue;
        const text = catalogue[key];
        // 未翻译该键 -> 由 _getMessage 回落 def（英文），不属于本类缺陷
        if (text === undefined) continue;
        const missing = required.filter((p) => !text.includes(`\${${p}}`));
        if (missing.length === 0) continue;
        violations.push({
            locale,
            key,
            missing,
            naked: missing.filter((p) => new RegExp(`(^|[^\\w$])${p}([^\\w}]|$)`, "m").test(text)),
        });
    }
}

const describeViolation = (v: Violation) =>
    `${v.locale}/${v.key} 缺 ${v.missing.map((p) => `\${${p}}`).join(", ")}` +
    (v.naked.length ? `（其中 ${v.naked.join(", ")} 已成裸词，会原样显示）` : "");

describe("i18n placeholder contract", () => {
    it("scans every translated key against the English placeholders", () => {
        // 扫描本身要有效：至少应覆盖到 Doctor 弹窗那几个键
        expect(base["Doctor.Dialogue.Main"]).toContain("${issues}");
        expect(catalogues.size).toBeGreaterThan(5);
        expect(Object.keys(base).length).toBeGreaterThan(500);
    });

    it("keeps the Config Doctor dialogue fully interpolatable in every language", () => {
        // 用户可见的模态框：弹窗一旦缺占位符，会直接显示裸词或写死的内容
        const doctorViolations = violations.filter((v) => v.key.startsWith("Doctor."));
        expect(doctorViolations.map(describeViolation)).toEqual([]);
    });

    it("introduces no violation beyond the shrink-only baseline", () => {
        const known = new Set(BASELINE.map(([locale, key]) => `${locale}/${key}`));
        const unexpected = violations.filter((v) => !known.has(`${v.locale}/${v.key}`));
        expect(unexpected.map(describeViolation)).toEqual([]);
    });

    it("keeps the baseline shrink-only", () => {
        expect(
            violations.length,
            `已知违规 ${violations.length} 处 / 基线 ${BASELINE.length} 处。` +
                "若已修复，请从 BASELINE 中删除对应行；若是新回归，请修译文而不是放宽基线。"
        ).toBeLessThanOrEqual(BASELINE.length);
    });
});
