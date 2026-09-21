/**
 * @file sellerDocsHygiene.unit.spec.ts
 * @description Persistent gate for the seller/buyer documentation rule.
 *
 * Seller/buyer-facing copy must express value in accurate credits (for example base 200 积分,
 * member 800 积分, pro 1200 积分) or as the plan-scoped model quota the server issues
 * ("服务端按档位下发的模型额度（精确数值以 /api/activate 返回为准）"). It must never map a price or a
 * model_quota value onto Renminbi: no yen sign, no `RMB`, no `人民币`, and no `<number>元` amount.
 *
 * This spec fails the unit suite if such a form appears in any document under `docs/` (plus the
 * public `updates.md`) outside the explicit internal allowlist below, so the rule cannot regress.
 * It is collected automatically by the existing `test:unit` include glob for `.unit.spec.ts` files.
 *
 * The allowlist is deliberately small and every entry carries a written reason. Add an entry only
 * for an internal technical or historical record that legitimately needs the currency; never for a
 * document a seller or buyer is meant to read.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Seller/buyer-facing documents that must always exist and must state value in credits only. */
const REQUIRED_SELLER_BUYER_DOCS = [
    // 商品页草稿：文件顶部即声明「本页面向买家，用于评审口径」。
    "docs/PRO_SYNC_SPACE-LISTING.zh.md",
    // 真机验收清单：验收口径会直接变成对外话术，禁止把额度写成人民币。
    "docs/DEVICE-ACCEPTANCE-2.0.15.zh.md",
] as const;

/**
 * Buyer-facing documents that are still being drafted on a parallel branch and may be absent from
 * this tree. When they merge, the rule applies identically and the broad scan below enforces it.
 * The known draft of BUYER-READINESS-2.0.15.zh.md still carries a 价格口径 row with 月卡 prices and
 * a model_quota row whose values are yuan; both must become accurate credit amounts (or the
 * server-issued quota wording) before the file lands.
 */
const MERGE_PENDING_SELLER_BUYER_DOCS = ["docs/BUYER-READINESS-2.0.15.zh.md"] as const;

const ALL_SELLER_BUYER_DOCS: readonly string[] = [
    ...REQUIRED_SELLER_BUYER_DOCS,
    ...MERGE_PENDING_SELLER_BUYER_DOCS,
];

/**
 * Explicit whitelist of internal documents that may contain the currency. A seller or buyer is
 * never expected to read these; each reason records why the exclusion is safe. Internal billing
 * and pricing documents (for example the backend credit policy) live in the sibling workspace
 * repository, not here, and are intentionally out of this gate's scope.
 */
const INTERNAL_DOC_ALLOWLIST = new Map<string, string>([
    [
        "docs/changes/codex-2026-09-12-oc-brand-and-entitlement-copy.md",
        "内部变更记录：描述的是「移除账户页人民币等值额度展示」这一历史动作，不是对外文案。",
    ],
    [
        "docs/handoff/2026-09-12-oc-brand-and-entitlement-copy.md",
        "内部交接记录：同样只记录移除动作，保留历史事实。",
    ],
    [
        "updates.md",
        "公开发布历史（英文）：「RMB-equivalent … removes」记录移除行为；用户明确保留，是否改写由本人决定。",
    ],
]);

type ForbiddenForm = { readonly id: string; readonly pattern: RegExp; readonly example: string };

const FORBIDDEN_RMB_FORMS: readonly ForbiddenForm[] = [
    { id: "yen-sign", pattern: /[¥￥]/u, example: "¥9.33 月卡" },
    { id: "rmb-code", pattern: /\bRMB\b/iu, example: "RMB-equivalent quota" },
    { id: "renminbi", pattern: /人民币/u, example: "人民币等值额度" },
    { id: "yuan-amount", pattern: /\d+\s*元/u, example: "12 元额度" },
];

type Violation = { readonly file: string; readonly form: string; readonly line: number; readonly text: string };

/** Returns every forbidden Renminbi form found in one document, line by line. */
function findForbiddenForms(file: string, document: string): Violation[] {
    const violations: Violation[] = [];
    document.split(/\r?\n/u).forEach((text, index) => {
        for (const form of FORBIDDEN_RMB_FORMS) {
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

describe("seller/buyer documentation integrity (no RMB mapping)", () => {
    it("detects every forbidden Renminbi form", () => {
        for (const form of FORBIDDEN_RMB_FORMS) {
            const found = findForbiddenForms("sample.md", `前言\n${form.example}\n后记`);
            expect(found.map((violation) => violation.form)).toContain(form.id);
            expect(found[0]?.line).toBe(2);
        }
    });

    it("accepts accurate credit mappings and unrelated 元 words", () => {
        const acceptable = [
            "基础版 200 积分、会员 800 积分、Pro 1200 积分。",
            "服务端按档位下发的模型额度（精确数值以 /api/activate 返回为准）。",
            "## 7. 与单元测试的关系",
            "如何设置第二单元和后续单元",
            "原始 CSS、许可证和来源元数据",
        ].join("\n");
        expect(findForbiddenForms("clean.md", acceptable)).toEqual([]);
    });

    it("keeps every required seller/buyer document present and free of Renminbi", () => {
        for (const document of REQUIRED_SELLER_BUYER_DOCS) {
            expect(existsSync(join(repositoryRoot, document)), `missing ${document}`).toBe(true);
            expect(findForbiddenForms(document, readDocument(repositoryRoot, document)).map(describeViolation)).toEqual([]);
        }
    });

    it("enforces the same rule for the merge-pending buyer documents", () => {
        for (const document of MERGE_PENDING_SELLER_BUYER_DOCS) {
            if (!existsSync(join(repositoryRoot, document))) continue;
            expect(findForbiddenForms(document, readDocument(repositoryRoot, document)).map(describeViolation)).toEqual([]);
        }
    });

    it("keeps every document outside the internal allowlist free of Renminbi", () => {
        const violations: string[] = [];
        for (const document of collectScannedDocuments(repositoryRoot)) {
            if (INTERNAL_DOC_ALLOWLIST.has(document)) continue;
            violations.push(...findForbiddenForms(document, readDocument(repositoryRoot, document)).map(describeViolation));
        }
        expect(violations).toEqual([]);
    });

    it("scans the seller/buyer documents and the public changelog", () => {
        const scanned = collectScannedDocuments(repositoryRoot);
        for (const document of REQUIRED_SELLER_BUYER_DOCS) expect(scanned).toContain(document);
        expect(scanned).toContain("updates.md");
        expect(scanned.length).toBeGreaterThan(20);
    });

    it("records a written reason for every allowlisted document", () => {
        for (const [document, reason] of INTERNAL_DOC_ALLOWLIST) {
            expect(reason.length, `reason for ${document}`).toBeGreaterThan(10);
            expect(existsSync(join(repositoryRoot, document)), `allowlisted file missing: ${document}`).toBe(true);
            expect(ALL_SELLER_BUYER_DOCS).not.toContain(document);
        }
    });
});
