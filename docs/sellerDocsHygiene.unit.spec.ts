/**
 * @file sellerDocsHygiene.unit.spec.ts
 * @description Persistent gate for the seller/buyer documentation rule.
 *
 * The rule is a mapping rule: seller/buyer-facing copy must never bind an amount of money to
 * credits, quota, a plan or an entitlement ("12 元额度", "¥12 额度", "1 积分 = 0.015 元",
 * "积分 200 折合 ¥3", "model_quota 12.0 元", "pro_grant_yuan=18.00 × credits_per_yuan"). Value is
 * stated in credits (base 200 积分, member 800 积分, pro 1200 积分) or as the server-issued model
 * quota ("服务端按档位下发的模型额度（精确数值以 /api/activate 返回为准）").
 *
 * Mentioning 人民币 is NOT itself a violation. A policy or technical note that records *which*
 * mapping is deliberately not written (for example "文档中不写人民币↔积分映射") is compliant, and a
 * plain price line ("¥10 一口价") carries no credit/quota mapping and is therefore compliant too.
 *
 * This spec previously failed on any 人民币 / ¥ / "<number> 元" occurrence in any document, which was
 * broader than the rule it was meant to enforce: the correct FOUNDATION-INDEX note that says the
 * mapping is not written could not pass. It is narrowed here to a real money-to-credit mapping,
 * while the buyer-facing listing and acceptance documents keep the strict form (no yen sign, no
 * 人民币, no "<number> 元" and no RMB) because their copy states value in credits only.
 *
 * Two levels:
 *   1. every markdown document under `docs/` plus the public `updates.md` is scanned for a true
 *      money-to-credit/quota mapping;
 *   2. the buyer-facing documents in REQUIRED_SELLER_BUYER_DOCS are additionally held to the strict
 *      price-free form.
 *
 * It is collected automatically by the existing `test:unit` include glob for `.unit.spec.ts` files.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Seller/buyer-facing documents that must always exist and are held to the strict price-free form. */
const REQUIRED_SELLER_BUYER_DOCS = [
    // 商品页草稿：文件顶部即声明「本页面向买家，用于评审口径」。
    "docs/PRO_SYNC_SPACE-LISTING.zh.md",
    // 真机验收清单：验收口径会直接变成对外话术，禁止出现任何价格形态。
    "docs/DEVICE-ACCEPTANCE-2.0.15.zh.md",
] as const;

/**
 * Buyer-facing documents still being drafted on a parallel branch. When they merge they obey the
 * same rule; the broad scan below already covers them while they are present.
 */
const MERGE_PENDING_SELLER_BUYER_DOCS = ["docs/BUYER-READINESS-2.0.15.zh.md"] as const;

type ForbiddenForm = { readonly id: string; readonly pattern: RegExp; readonly example: string };

/** A money amount that could be mapped onto a value term: `¥12`, `12 元`, `RMB 12`. */
const MONEY = "(?:[¥￥]\\s*\\d+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?\\s*元|RMB\\s*\\d+(?:\\.\\d+)?)";
/** A value term that must never carry a price: credits, quota, a plan entitlement. */
const VALUE_TERM = "(?:积分|额度|quota|credits?)";

/** Real money-to-credit/quota mappings. Matching one of these fails the gate. */
const FORBIDDEN_MAPPING_FORMS: readonly ForbiddenForm[] = [
    {
        id: "money-with-value-term",
        pattern: new RegExp(`${MONEY}[^。\\n]{0,16}?${VALUE_TERM}|${VALUE_TERM}[^。\\n]{0,16}?${MONEY}`, "iu"),
        example: "12 元额度",
    },
    {
        id: "credit-currency-equation",
        pattern: new RegExp(
            `(?:积分|额度|quota|credits?)[^\\n]{0,12}?[=＝][^\\n]{0,12}?${MONEY}|${MONEY}[^\\n]{0,12}?[=＝][^\\n]{0,12}?(?:积分|额度|quota|credits?)`,
            "iu"
        ),
        example: "1 积分 = 0.015 元",
    },
    {
        id: "money-equivalence",
        pattern: new RegExp(`(?:折合|等值|相当于|换算|兑换|折为)[^\\n]{0,12}?${MONEY}`, "iu"),
        example: "积分 200 折合 ¥3",
    },
    {
        id: "latin-yuan-credit",
        pattern: /(?=[^\n]*yuan)(?=[^\n]*\d)(?=[^\n]*(?:credits?|积分|额度|quota))/iu,
        example: "pro_grant_yuan=18.00 × credits_per_yuan",
    },
];

/**
 * The strict form reserved for the buyer-facing listing and acceptance documents: no yen sign, no
 * 人民币, no "<number> 元" amount and no RMB code, whatever the context.
 */
const STRICT_PRICE_FORMS: readonly ForbiddenForm[] = [
    { id: "yen-sign", pattern: /[¥￥]/u, example: "¥9.33 月卡" },
    { id: "renminbi", pattern: /人民币/u, example: "人民币额度" },
    { id: "yuan-amount", pattern: /\d+\s*元/u, example: "12 元额度" },
    { id: "rmb-code", pattern: /\bRMB\b/iu, example: "RMB-equivalent quota" },
];

type Violation = { readonly file: string; readonly form: string; readonly line: number; readonly text: string };

/** Applies one form set to a document line by line. */
function findForms(file: string, document: string, forms: readonly ForbiddenForm[]): Violation[] {
    const violations: Violation[] = [];
    document.split(/\r?\n/u).forEach((text, index) => {
        for (const form of forms) {
            if (form.pattern.test(text)) {
                violations.push({ file, form: form.id, line: index + 1, text: text.trim() });
            }
        }
    });
    return violations;
}

/** All markdown documents in `docs/` plus the public changelog, as repository-relative POSIX paths. */
function collectScannedDocuments(root: string): string[] {
    const documents: string[] = [];
    const walk = (directory: string): void => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            if (entry.name.startsWith(".")) continue;
            const absolute = join(directory, entry.name);
            if (entry.isDirectory()) walk(absolute);
            else if (entry.isFile() && entry.name.endsWith(".md")) {
                documents.push(relative(root, absolute).replace(/\\/gu, "/"));
            }
        }
    };
    const docsDirectory = join(root, "docs");
    if (existsSync(docsDirectory)) walk(docsDirectory);
    if (existsSync(join(root, "updates.md"))) documents.push("updates.md");
    return documents.sort();
}

function readDocument(root: string, file: string): string {
    return readFileSync(join(root, file), "utf8");
}

function describeViolation(violation: Violation): string {
    return `${violation.file}:${violation.line} [${violation.form}] ${violation.text}`;
}

describe("seller/buyer documentation integrity (no money-to-credit mapping)", () => {
    it("detects every forbidden mapping form", () => {
        for (const form of FORBIDDEN_MAPPING_FORMS) {
            const found = findForms("sample.md", `前言\n${form.example}\n后记`, [form]);
            expect(found.map((violation) => violation.form), `form ${form.id}`).toEqual([form.id]);
            expect(found[0]?.line, `form ${form.id}`).toBe(2);
        }
    });

    it("accepts a policy note that says the mapping is not written, a plain price and credit-only wording", () => {
        const acceptable = [
            "文档中不写人民币↔积分映射。",
            "从账户权益摘要中移除人民币等值模型额度展示。",
            "不再显示 `¥... 元等值`，服务端额度字段保留不变。",
            "这份说明只讲人民币与积分的换算口径，并不写出任何映射。",
            "¥10 一口价",
            "基础版 200 积分、会员 800 积分、Pro 1200 积分。",
            "服务端按档位下发的模型额度（精确数值以 /api/activate 返回为准）。",
            "## 7. 与单元测试的关系",
            "如何设置第二单元和后续单元",
            "原始 CSS、许可证和来源元数据",
        ].join("\n");
        expect(findForms("clean.md", acceptable, FORBIDDEN_MAPPING_FORMS).map(describeViolation)).toEqual([]);
    });

    it("keeps the required buyer-facing documents present and in the strict price-free form", () => {
        for (const document of REQUIRED_SELLER_BUYER_DOCS) {
            expect(existsSync(join(repositoryRoot, document)), `missing ${document}`).toBe(true);
            expect(
                findForms(document, readDocument(repositoryRoot, document), STRICT_PRICE_FORMS).map(describeViolation),
                `${document} must not contain any price form`
            ).toEqual([]);
        }
    });

    it("enforces the mapping and strict rules for the merge-pending buyer documents", () => {
        for (const document of MERGE_PENDING_SELLER_BUYER_DOCS) {
            if (!existsSync(join(repositoryRoot, document))) continue;
            expect(
                findForms(document, readDocument(repositoryRoot, document), [...FORBIDDEN_MAPPING_FORMS, ...STRICT_PRICE_FORMS]).map(describeViolation)
            ).toEqual([]);
        }
    });

    it("keeps every document outside the strict set free of a money-to-credit mapping", () => {
        const violations: string[] = [];
        for (const document of collectScannedDocuments(repositoryRoot)) {
            violations.push(...findForms(document, readDocument(repositoryRoot, document), FORBIDDEN_MAPPING_FORMS).map(describeViolation));
        }
        expect(violations).toEqual([]);
    });

    it("scans the seller/buyer documents and the public changelog", () => {
        const scanned = collectScannedDocuments(repositoryRoot);
        for (const document of REQUIRED_SELLER_BUYER_DOCS) expect(scanned).toContain(document);
        expect(scanned).toContain("updates.md");
        expect(scanned.length).toBeGreaterThan(20);
    });
});
