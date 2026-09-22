import { Notice, Setting, type App, type ButtonComponent } from "@/deps.ts";
import { get } from "svelte/store";
import { isProNamespaceReadOnly } from "./CmdAIAgent";
import type { CmdAIAgent, EmailAccountSession, ProNamespaceState } from "./CmdAIAgent";

/**
 * 账户区块（邮箱 / Pro 独立同步空间）的可复用渲染。
 *
 * 账户详情弹窗（`AIAgentAccountModal`）与工具中心账户页的入口弹窗
 * （`OsycAccountSectionModal`）共用这一份实现：两处展示必须永远一致，不允许
 * 各自维护一套邮箱或 Pro 逻辑。
 *
 * `refresh` 由宿主提供：账户弹窗传整窗重绘，入口弹窗传自身重绘。渲染函数只画
 * 界面，登录 / 发码 / 开通等动作一律只由用户点击触发。
 */
export interface AccountSectionContext {
    app: App;
    agent: CmdAIAgent;
    refresh: () => void;
}

/** 把 Pro 空间状态转成一行中文文案；非 Pro 原样回传服务端 403 detail。 */
export function describeProNamespace(state: ProNamespaceState): string {
    if (!state.available) return state.message || "Pro 会员专属权益";
    const parts = [
        state.namespace ? `库名 ${state.namespace}` : "库名 —",
        state.enabled ? "已开通" : "未开通",
        state.ready ? "就绪" : "未就绪",
        state.read_only ? "只读保留" : "可读写",
        `已用 ${state.used_mb} MB`,
    ];
    return parts.join(" · ");
}

/**
 * 已登录邮箱但尚未绑定卡密：不报错，明确引导下一步。
 *
 * 邮箱登录本身会把账户建出来，但只有卡密才带来档位与额度；这条引导在入口行
 * 与账户区块共用，避免用户看到「已登录」却不知道还差什么。
 */
export const EMAIL_UNACTIVATED_HINT = "绑定卡密后即可使用";

/** 邮箱入口行状态（纯只读快照，不发请求、不登录）。 */
export function describeEmailEntryStatus(account: EmailAccountSession | null): string {
    if (!account) return "未登录：用邮箱验证码登录，或绑定卡密";
    const cards = account.cards.length;
    return cards > 0
        ? `已登录 ${account.masked} · 已绑定 ${cards} 个卡密`
        : `已登录 ${account.masked} · 未绑定卡密（${EMAIL_UNACTIVATED_HINT}）`;
}

/**
 * 账户区块的邮箱状态行。
 *
 * 已登录即附带 G2 的「仅本次运行有效」说明；尚未绑定卡密时再补未激活引导，
 * 让「未激活但已登录邮箱」的用户一眼看到下一步，而不是停留在错误状态。
 */
export function describeEmailSessionStatus(account: EmailAccountSession): string {
    const base = `已登录 ${account.masked}`;
    if (account.cards.length === 0) {
        return `${base} · 未激活：${EMAIL_UNACTIVATED_HINT}（${EMAIL_SESSION_HINT}）`;
    }
    return `${base}（${EMAIL_SESSION_HINT}）`;
}

/** Pro 独立同步空间入口行状态（纯只读快照，不发请求、不切换空间）。 */
export function describeProNamespaceEntryStatus(state: ProNamespaceState | null): string {
    if (!state) return "尚未读取：激活账户后可查看 Pro 专属空间";
    if (!state.available) return `未开通：${state.message || "Pro 会员专属权益"}`;
    if (isProNamespaceReadOnly(state)) return `只读保留（Pro 已过期） · 已用 ${state.used_mb} MB`;
    if (state.enabled) return `已开通${state.ready ? "（就绪）" : ""} · 已用 ${state.used_mb} MB`;
    return `未开通 · 已用 ${state.used_mb} MB`;
}

/**
 * G2：邮箱会话只留在内存，插件重启后必须重新验证。状态行必须把这件事说清楚，
 * 否则用户会把「重启后需要重新验证」当成「掉登录」。
 */
export const EMAIL_SESSION_HINT = "邮箱会话仅在本次运行有效，重启 Obsidian 后需重新验证";

/** G4：两个绑定方向的显式文案。都叫「绑定」会混淆，界面上必须写清方向。 */
export const EMAIL_BIND_DIRECTION_FORWARD = "卡密 → 邮箱（绑定当前卡密）";
export const EMAIL_BIND_DIRECTION_REVERSE = "邮箱 → 卡密（用邮箱账户并入卡密）";

/**
 * 邮箱登录 / 绑定卡密。
 *
 * 邮箱是高于卡密的身份锚点：验证通过后卡密跟着邮箱走，换设备只认邮箱 + 验证码。
 * 会话 token 只留在内存里（不落盘），插件重启后需要重新验证一次邮箱。
 *
 * 区块内有两个方向相反的「绑定」，必须分开：
 * - **邮箱 → 卡密（并入）**：先邮箱验证码登录拿到内存会话，再把已有卡密并入该邮箱；
 * - **卡密 → 邮箱（绑定）**：当前卡密已激活（Bearer token），把「当前卡密」并入邮箱，
 *   需要 `purpose="bind"` 的验证码。
 *
 * 所有动作（发码 / 登录 / 两种绑定）都只由用户点击触发，渲染时绝不自动执行。
 */
export function renderEmailAccountSection(contentEl: HTMLElement, ctx: AccountSectionContext): void {
    const box = contentEl.createDiv({ cls: "ai-account-email-login" });
    box.createEl("p", {
        text: "邮箱是高于卡密的身份锚点：验证邮箱后绑定的卡密会自动载入，换设备只需邮箱验证码。",
        cls: "ai-account-hint",
    });
    // G2：状态行明说会话只在本进程有效，避免重启后被当成「掉登录」。
    box.createEl("p", { text: `说明：${EMAIL_SESSION_HINT}。`, cls: "ai-account-hint" });

    const emailSetting = new Setting(box).setName("邮箱地址");
    const emailInput = emailSetting.controlEl.createEl("input", {
        type: "email",
        placeholder: "name@example.com",
        attr: { autocomplete: "email", autocapitalize: "none", spellcheck: "false" },
    });
    emailInput.addClass("ai-account-input");

    const statusEl = box.createEl("p", {
        text: `状态：尚未验证邮箱（${EMAIL_SESSION_HINT}）`,
        cls: "ai-account-hint",
    });
    const setStatus = (text: string) => {
        statusEl.setText(`状态：${text}`);
    };

    // 倒计时只负责解禁按钮，不自动发码：真正发码仍由各按钮的 onClick 触发。
    const makeCountdown = (getButton: () => ButtonComponent | null, resetText: string) => {
        let timer: number | null = null;
        return (seconds: number) => {
            const button = getButton();
            if (!button) return;
            let left = seconds;
            button.setDisabled(true);
            button.setButtonText(`重新发送（${left}s）`);
            timer = window.setInterval(() => {
                left -= 1;
                if (left <= 0) {
                    if (timer !== null) window.clearInterval(timer);
                    timer = null;
                    getButton()?.setDisabled(false);
                    getButton()?.setButtonText(resetText);
                    return;
                }
                getButton()?.setButtonText(`重新发送（${left}s）`);
            }, 1000);
        };
    };

    let sendButton: ButtonComponent | null = null;
    const startCountdown = makeCountdown(() => sendButton, "发送验证码");

    emailSetting.addButton((btn) => {
        sendButton = btn;
        btn.setButtonText("发送验证码")
            .setIcon("send")
            .setCta()
            .onClick(async () => {
                const email = emailInput.value.trim();
                if (!email) {
                    new Notice("请输入邮箱地址");
                    return;
                }
                btn.setDisabled(true);
                const result = await ctx.agent.requestEmailCode(email, "login");
                new Notice(result.message);
                if (result.ok) {
                    startCountdown(60);
                    // G7：状态行同样只回显服务端防枚举文案，不回显明文邮箱。
                    setStatus(result.message);
                } else {
                    btn.setDisabled(false);
                    setStatus(result.message);
                }
            });
    });

    const codeSetting = new Setting(box).setName("验证码");
    const codeInput = codeSetting.controlEl.createEl("input", {
        type: "text",
        placeholder: "6 位验证码",
        attr: { inputmode: "numeric", autocomplete: "one-time-code" },
    });
    codeInput.addClass("ai-account-input");
    codeSetting.addButton((btn) =>
        btn.setButtonText("登录").setIcon("log-in").setCta().onClick(async () => {
            btn.setDisabled(true);
            const result = await ctx.agent.loginWithEmail(emailInput.value, codeInput.value);
            btn.setDisabled(false);
            new Notice(result.message);
            setStatus(result.message);
            if (result.ok) {
                codeInput.value = "";
                ctx.refresh();
            }
        })
    );

    const account = ctx.agent.emailAccount;
    if (account) {
        // 未激活但已登录邮箱时给明确引导（不报错），并保留 G2 会话说明。
        setStatus(describeEmailSessionStatus(account));
        const cards = account.cards.map((c) => c.card_key).join("、") || "暂未绑定卡密";
        box.createEl("p", { text: `已关联卡密：${cards}`, cls: "ai-account-hint" });
    }

    // ── 方向一：邮箱 → 卡密（并入）──
    new Setting(box).setName(EMAIL_BIND_DIRECTION_REVERSE).setHeading();
    const bindSetting = new Setting(box)
        .setName("绑定卡密")
        .setDesc("方向「邮箱 → 卡密」：把已有卡密并入当前邮箱账户；需要先完成一次邮箱验证码登录。");
    const cardInput = bindSetting.controlEl.createEl("input", {
        type: "password",
        placeholder: "输入卡密",
        attr: { autocomplete: "off", autocapitalize: "none", spellcheck: "false" },
    });
    cardInput.addClass("ai-account-input");
    bindSetting.addButton((btn) =>
        btn.setButtonText("绑定").setIcon("link").setCta().onClick(async () => {
            const cardKey = cardInput.value.trim();
            if (!cardKey) {
                new Notice("请输入卡密");
                return;
            }
            btn.setDisabled(true);
            const result = await ctx.agent.bindCardToEmail(cardKey);
            btn.setDisabled(false);
            if (result.ok) cardInput.value = "";
            new Notice(result.message);
            setStatus(result.message);
            if (result.ok) ctx.refresh();
        })
    );

    // ── 方向二：卡密 → 邮箱（绑定当前卡密）──
    new Setting(box).setName(EMAIL_BIND_DIRECTION_FORWARD).setHeading();
    box.createEl("p", {
        text: "方向「卡密 → 邮箱」：把当前正在使用的卡密并入上面的邮箱地址。需要先发送「绑定」用途验证码，"
            + "登录验证码与它不通用；绑定不会切换本机卡密，也不会自动执行。",
        cls: "ai-account-hint",
    });
    const bindCodeSetting = new Setting(box).setName("绑定验证码");
    const bindCodeInput = bindCodeSetting.controlEl.createEl("input", {
        type: "text",
        placeholder: "6 位绑定验证码",
        attr: { inputmode: "numeric", autocomplete: "one-time-code" },
    });
    bindCodeInput.addClass("ai-account-input");
    let bindSendButton: ButtonComponent | null = null;
    const startBindCountdown = makeCountdown(() => bindSendButton, "发送绑定验证码");
    bindCodeSetting.addButton((btn) => {
        bindSendButton = btn;
        btn.setButtonText("发送绑定验证码")
            .setIcon("send")
            .onClick(async () => {
                const email = emailInput.value.trim();
                if (!email) {
                    new Notice("请输入邮箱地址");
                    return;
                }
                btn.setDisabled(true);
                // 关键：purpose=bind 与登录验证码分开；否则服务端 bind_email 必然 400。
                const result = await ctx.agent.requestEmailCode(email, "bind");
                new Notice(result.message);
                if (result.ok) {
                    startBindCountdown(60);
                    // G7：绑定发码与登录发码同一口径，只回显服务端文案。
                    setStatus(result.message);
                } else {
                    btn.setDisabled(false);
                    setStatus(result.message);
                }
            });
    });
    bindCodeSetting.addButton((btn) =>
        btn.setButtonText("绑定到邮箱").setIcon("link").setCta().onClick(async () => {
            const email = emailInput.value.trim();
            const code = bindCodeInput.value.trim();
            if (!email) {
                new Notice("请输入邮箱地址");
                return;
            }
            if (!code) {
                new Notice("请输入绑定验证码");
                return;
            }
            btn.setDisabled(true);
            const result = await ctx.agent.bindEmailToAccount(email, code);
            btn.setDisabled(false);
            if (result.ok) bindCodeInput.value = "";
            new Notice(result.message);
            setStatus(result.message);
            // 成功后才刷新，回显服务端掩码 / 关联卡密与只读绑定回显。
            if (result.ok) ctx.refresh();
        })
    );

    if (ctx.agent.emailBindSummary) {
        box.createEl("p", { text: `绑定回显：${ctx.agent.emailBindSummary}`, cls: "ai-account-hint" });
    }
}

/**
 * Pro「独立同步空间」区块：显式开通 + 迁移进度回显。
 *
 * 打开弹窗只做一次 GET 状态回显（只读）；真正切换同步目标只发生在用户点击
 * 「开通并切换到独立空间」时。非 Pro 卡服务端返回 403，这里原样展示 detail，
 * 并把按钮保持在不可用状态；Pro 已过期是 200 + status=expired / read_only=true，
 * 这里展示「只读保留」并给续费引导，按钮不整块禁用。
 */
export function renderProNamespaceSection(contentEl: HTMLElement, ctx: AccountSectionContext): void {
    const box = contentEl.createDiv({ cls: "ai-account-pro-namespace" });
    new Setting(box).setName("独立同步空间").setHeading();
    box.createEl("p", {
        text: "Pro 专属能力「独立同步空间」是一个独立数据库。切换后本 vault 同步到独立空间，旧空间数据保留、可随时切回。",
        cls: "ai-account-hint",
    });
    const statusEl = box.createEl("p", { text: "空间状态：加载中…", cls: "ai-account-hint" });
    const renewEl = box.createEl("p", { text: "", cls: "ai-account-hint" });

    let button: ButtonComponent | null = null;
    const renderStatus = (state: ProNamespaceState | null) => {
        if (!state) {
            statusEl.setText("空间状态：读取失败，请稍后重试");
            button?.setDisabled(true);
            return;
        }
        const expired = isProNamespaceReadOnly(state);
        statusEl.setText(`空间状态：${describeProNamespace(state)}${expired ? " · 只读保留" : ""}`);
        if (expired) {
            renewEl.setText("Pro 订阅已过期：空间数据只读保留（不会删除，可导出），续费后即可恢复读写。");
            // 过期不等于无权限：按钮保留可点，点击给续费引导，整块不禁用。
            button?.setDisabled(false);
            button?.setButtonText("去续费");
        } else {
            renewEl.setText("");
            button?.setButtonText("开通并切换到独立空间");
            // 非 Pro（403）时 available=false，按钮保持不可用。
            button?.setDisabled(!state.available);
        }
    };

    new Setting(box)
        .setName("当前空间")
        .setDesc("切换会改变本 vault 的同步目标；旧空间数据不会被删除，可切回。")
        .addButton((btn) => {
            button = btn;
            btn.setButtonText("开通并切换到独立空间")
                .setIcon("database")
                .setCta()
                .setDisabled(true);
            // 仅用户点击才切换档案；onOpen 里绝不调用开通。
            btn.onClick(async () => {
                const state = ctx.agent.proNamespace;
                if (state && isProNamespaceReadOnly(state)) {
                    new Notice("Pro 订阅已过期：空间处于只读保留，请先续费（重新激活卡密）后再开通或切换；数据不会删除。");
                    return;
                }
                if (!state?.available) return;
                btn.setDisabled(true);
                btn.setButtonText("正在开通并切换…");
                const result = await ctx.agent.requestProNamespace();
                new Notice(result.message);
                if (result.ok) {
                    // 完成后整块重绘，回显新空间、用量与只读状态。
                    ctx.refresh();
                    return;
                }
                renderStatus(ctx.agent.proNamespace);
                btn.setButtonText("开通并切换到独立空间");
            });
        });

    if (!get(ctx.agent.state).activated) {
        statusEl.setText("空间状态：激活账户后可查看 Pro 专属空间");
        return;
    }
    // 只读回显服务端状态，不切换任何档案。
    void ctx.agent.proNamespaceStatus().then(() => renderStatus(ctx.agent.proNamespace));
}
