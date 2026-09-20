import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 与同目录既有 CmdAIAgent 规格一致：单元环境里 obsidian 不可用，
// 断言纯状态函数时只把 @/deps.ts 的值导入替换成桩。
vi.mock("@/deps.ts", () => ({
    Notice: class {},
    Setting: class {},
    requestUrl: () => {},
}));

import { emptyProNamespaceState } from "./CmdAIAgent";
import type { EmailAccountSession, ProNamespaceState } from "./CmdAIAgent";
import { describeEmailEntryStatus, describeProNamespaceEntryStatus } from "./osycAccountSections";

const toolsSource = readFileSync(
    fileURLToPath(new URL("./AIAgentToolsModal.ts", import.meta.url)),
    "utf8"
);
const accountModalSource = readFileSync(
    fileURLToPath(new URL("./AIAgentAccountModal.ts", import.meta.url)),
    "utf8"
);
const sectionModalSource = readFileSync(
    fileURLToPath(new URL("./OsycAccountSectionModal.ts", import.meta.url)),
    "utf8"
);
const sectionsSource = readFileSync(
    fileURLToPath(new URL("./osycAccountSections.ts", import.meta.url)),
    "utf8"
);

/** 工具中心「账户」页（renderAccount）的源码切片。 */
function accountPageSource(): string {
    const start = toolsSource.indexOf("private renderAccount(");
    const end = toolsSource.indexOf("private renderEmailEntry(");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return toolsSource.slice(start, end);
}

describe("工具中心账户页 · 邮箱与同步空间入口", () => {
    it("两个入口都排在账户页里，且放在一起", () => {
        const page = accountPageSource();
        expect(page).toContain("this.renderEmailEntry(contentEl)");
        expect(page).toContain("this.renderProNamespaceEntry(contentEl)");
        // 两个入口相邻：邮箱在前，同步空间紧跟其后
        expect(page.indexOf("this.renderEmailEntry(contentEl)")).toBeLessThan(
            page.indexOf("this.renderProNamespaceEntry(contentEl)")
        );
        // 落在现有账户页里（我的账户之后、OsyC 设置之前），没有另开分组
        expect(page.indexOf('setName("我的账户")')).toBeLessThan(page.indexOf("this.renderEmailEntry(contentEl)"));
        expect(page.indexOf("this.renderProNamespaceEntry(contentEl)")).toBeLessThan(page.indexOf('setName("OsyC 设置")'));
    });

    it("邮箱入口显示登录/绑定状态，点击打开邮箱界面", () => {
        expect(toolsSource).toContain('setName("邮箱账户")');
        expect(toolsSource).toContain("describeEmailEntryStatus(this.agent.emailAccount)");
        expect(toolsSource).toContain('this.openAccountSection("email")');
    });

    it("同步空间入口显示开通/只读/用量状态，点击打开 Pro 界面", () => {
        expect(toolsSource).toContain('setName("独立同步空间（Pro）")');
        expect(toolsSource).toContain("describeProNamespaceEntryStatus(this.agent.proNamespace)");
        expect(toolsSource).toContain('this.openAccountSection("pro")');
        // 未激活时也要有明确说法，不假装已开通。
        expect(toolsSource).toContain("激活账户后可查看 Pro 专属空间");
    });

    it("点击入口打开对应界面：两个界面共用同一份区块实现", () => {
        // 入口弹窗按 kind 分派到共享渲染函数
        expect(sectionModalSource).toContain("renderEmailAccountSection(contentEl, ctx)");
        expect(sectionModalSource).toContain("renderProNamespaceSection(contentEl, ctx)");
        // 工具中心入口实际打开的是那个入口弹窗
        expect(toolsSource).toContain("new OsycAccountSectionModal(this.app, this.agent, kind).open()");
        // 账户弹窗委托同一份实现，不存在第二套邮箱/Pro 逻辑
        expect(accountModalSource).toContain("renderEmailAccountSection(contentEl, this.sectionContext())");
        expect(accountModalSource).toContain("renderProNamespaceSection(contentEl, this.sectionContext())");
        expect(sectionsSource).toContain("export function renderEmailAccountSection");
        expect(sectionsSource).toContain("export function renderProNamespaceSection");
    });

    it("Pro 未开通时入口显示正确状态", () => {
        const notPro: ProNamespaceState = {
            ...emptyProNamespaceState(),
            httpStatus: 403,
            available: false,
            message: "Pro 会员专属权益",
        };
        const label = describeProNamespaceEntryStatus(notPro);
        expect(label).toContain("未开通");
        expect(label).toContain("Pro 会员专属权益");
        // 状态还没读到就说还没读到，不谎称已开通
        expect(describeProNamespaceEntryStatus(null)).toContain("尚未读取");
    });

    it("Pro 已开通 / 只读保留时入口带回用量", () => {
        const enabled: ProNamespaceState = {
            ...emptyProNamespaceState(),
            httpStatus: 200,
            available: true,
            enabled: true,
            ready: true,
            used_mb: 128,
            namespace: "t_testnamespace_pro",
        };
        const opened = describeProNamespaceEntryStatus(enabled);
        expect(opened).toContain("已开通");
        expect(opened).toContain("128 MB");

        const readOnly = describeProNamespaceEntryStatus({ ...enabled, status: "expired", read_only: true });
        expect(readOnly).toContain("只读保留");
        expect(readOnly).toContain("128 MB");
    });

    it("邮箱未登录时入口显示正确状态", () => {
        expect(describeEmailEntryStatus(null)).toContain("未登录");

        const loggedIn: EmailAccountSession = { masked: "user***@example.com", cards: [], session: "test-session" };
        const noCard = describeEmailEntryStatus(loggedIn);
        expect(noCard).toContain("已登录");
        expect(noCard).toContain("未绑定卡密");

        const withCard: EmailAccountSession = {
            ...loggedIn,
            cards: [{ card_key: "TEST-CARD" }],
        };
        const bound = describeEmailEntryStatus(withCard);
        expect(bound).toContain("已登录");
        expect(bound).toContain("已绑定 1 个卡密");
    });

    it("入口是显式动作：渲染入口不自动登录，也不切换同步空间", () => {
        const page = accountPageSource();
        expect(page).not.toContain("requestEmailCode");
        expect(page).not.toContain("loginWithEmail");
        expect(page).not.toContain("bindCardToEmail");
        expect(page).not.toContain("requestProNamespace");
        // Pro 入口只允许一次只读 GET 回显
        expect(toolsSource).toContain("this.agent.proNamespaceStatus()");

        // 入口弹窗打开时也不登录、不切换空间
        const openAt = sectionModalSource.indexOf("override onOpen()");
        const renderAt = sectionModalSource.indexOf("private render(");
        expect(openAt).toBeGreaterThan(-1);
        expect(renderAt).toBeGreaterThan(openAt);
        const openBlock = sectionModalSource.slice(openAt, renderAt);
        expect(openBlock).not.toContain("requestProNamespace");
        expect(openBlock).not.toContain("loginWithEmail");
        expect(openBlock).not.toContain("requestEmailCode");
    });
});
