import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 账户邮箱区块的「显式动作」行为测试（G1/G4）。
 *
 * 单元环境没有 Obsidian，这里用最小 DOM 桩替换 @/deps.ts 的 Notice / Setting，
 * 捕获区块创建的输入框与按钮回调，验证：
 * - 只渲染区块不发码、不登录、不绑定；
 * - 只有点击对应按钮才调用 requestEmailCode / loginWithEmail / bindCardToEmail /
 *   bindEmailToAccount；
 * - 「绑定」验证码用 purpose=bind，绑定成功后才刷新。
 */
vi.mock("@/deps.ts", () => {
    const buttons: Array<Record<string, unknown>> = [];
    const inputs: Array<Record<string, unknown>> = [];
    (globalThis as unknown as Record<string, unknown>).__osycTestButtons = buttons;
    (globalThis as unknown as Record<string, unknown>).__osycTestInputs = inputs;

    class FakeEl {
        value = "";
        textContent = "";
        createDiv(): FakeEl {
            return new FakeEl();
        }
        createSpan(): FakeEl {
            return new FakeEl();
        }
        createEl(_tag: string, _options?: unknown): FakeEl {
            const el = new FakeEl();
            if (_tag === "input") inputs.push(el as unknown as Record<string, unknown>);
            return el;
        }
        addClass(): void {}
        setText(text: string): void {
            this.textContent = text;
        }
        empty(): void {}
        setAttribute(): void {}
    }

    class FakeButton {
        text = "";
        disabled = false;
        handlers: Array<() => Promise<void>> = [];
        setButtonText(text: string): FakeButton {
            this.text = text;
            return this;
        }
        setIcon(): FakeButton { return this; }
        setCta(): FakeButton { return this; }
        setWarning(): FakeButton { return this; }
        setDisabled(disabled: boolean): FakeButton {
            this.disabled = disabled;
            return this;
        }
        onClick(handler: () => Promise<void>): FakeButton {
            this.handlers.push(handler);
            return this;
        }
    }

    class FakeSetting {
        controlEl = new FakeEl();
        constructor(_el?: unknown) {}
        setName(): FakeSetting { return this; }
        setDesc(): FakeSetting { return this; }
        setHeading(): FakeSetting { return this; }
        setDisabled(): FakeSetting { return this; }
        addButton(callback: (button: FakeButton) => void): FakeSetting {
            const button = new FakeButton();
            buttons.push(button as unknown as Record<string, unknown>);
            callback(button);
            return this;
        }
    }

    class FakeNotice {
        constructor(public message?: string) {}
    }

    return {
        Notice: FakeNotice,
        Setting: FakeSetting,
        requestUrl: () => {},
    };
});

import { renderEmailAccountSection } from "./osycAccountSections";

interface CapturedButton {
    text: string;
    disabled: boolean;
    handlers: Array<() => Promise<void>>;
}

interface CapturedInput {
    value: string;
}

function testButtons(): CapturedButton[] {
    return (globalThis as unknown as Record<string, unknown>).__osycTestButtons as CapturedButton[];
}

function testInputs(): CapturedInput[] {
    return (globalThis as unknown as Record<string, unknown>).__osycTestInputs as CapturedInput[];
}

class TestEl {
    textContent = "";
    createDiv(): TestEl { return new TestEl(); }
    createSpan(): TestEl { return new TestEl(); }
    createEl(): TestEl { return new TestEl(); }
    addClass(): void {}
    setText(text: string): void {
        this.textContent = text;
    }
    empty(): void {}
    setAttribute(): void {}
}

interface TestAgent {
    emailAccount: unknown;
    emailBindSummary: string | null;
    requestEmailCode: ReturnType<typeof vi.fn>;
    loginWithEmail: ReturnType<typeof vi.fn>;
    bindCardToEmail: ReturnType<typeof vi.fn>;
    bindEmailToAccount: ReturnType<typeof vi.fn>;
}

function makeAgent(): TestAgent {
    return {
        emailAccount: null,
        emailBindSummary: null,
        requestEmailCode: vi.fn().mockResolvedValue({ ok: true, message: "已发送" }),
        loginWithEmail: vi.fn().mockResolvedValue({ ok: true, message: "已登录" }),
        bindCardToEmail: vi.fn().mockResolvedValue({ ok: true, message: "已并入" }),
        bindEmailToAccount: vi.fn().mockResolvedValue({ ok: true, message: "已绑定" }),
    };
}

describe("osycAccountSections · 邮箱区块显式动作", () => {
    let agent: TestAgent;
    let refresh: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        (globalThis as unknown as { window: unknown }).window = {
            setInterval: () => 0,
            clearInterval: () => {},
        };
        testButtons().length = 0;
        testInputs().length = 0;
        agent = makeAgent();
        refresh = vi.fn();
    });

    function render(): void {
        const contentEl = new TestEl();
        renderEmailAccountSection(contentEl as unknown as HTMLElement, {
            app: {} as never,
            agent: agent as never,
            refresh: refresh as unknown as () => void,
        });
    }

    async function click(index: number): Promise<void> {
        await testButtons()[index].handlers[0]();
    }

    it("渲染区块本身不发码、不登录、不绑定", () => {
        render();
        expect(agent.requestEmailCode).not.toHaveBeenCalled();
        expect(agent.loginWithEmail).not.toHaveBeenCalled();
        expect(agent.bindCardToEmail).not.toHaveBeenCalled();
        expect(agent.bindEmailToAccount).not.toHaveBeenCalled();
        expect(refresh).not.toHaveBeenCalled();
    });

    it("点击「发送验证码」才发 purpose=login 的码", async () => {
        render();
        testInputs()[0].value = "user@example.com";
        await click(0);
        expect(agent.requestEmailCode).toHaveBeenCalledWith("user@example.com", "login");
    });

    it("点击「发送绑定验证码」才发 purpose=bind 的码（G1）", async () => {
        render();
        testInputs()[0].value = "user@example.com";
        await click(3);
        expect(agent.requestEmailCode).toHaveBeenCalledWith("user@example.com", "bind");
    });

    it("点击「登录」只调用 loginWithEmail，不触发任何绑定", async () => {
        render();
        testInputs()[0].value = "user@example.com";
        testInputs()[1].value = "123456";
        await click(1);
        expect(agent.loginWithEmail).toHaveBeenCalledWith("user@example.com", "123456");
        expect(agent.bindEmailToAccount).not.toHaveBeenCalled();
        expect(agent.bindCardToEmail).not.toHaveBeenCalled();
    });

    it("点击「绑定卡密」走邮箱 → 卡密（bindCardToEmail）", async () => {
        render();
        testInputs()[2].value = "test-card";
        await click(2);
        expect(agent.bindCardToEmail).toHaveBeenCalledWith("test-card");
        expect(agent.bindEmailToAccount).not.toHaveBeenCalled();
    });

    it("点击「绑定到邮箱」走卡密 → 邮箱，成功后刷新", async () => {
        render();
        testInputs()[0].value = "user@example.com";
        testInputs()[3].value = "654321";
        await click(4);
        expect(agent.bindEmailToAccount).toHaveBeenCalledWith("user@example.com", "654321");
        expect(agent.bindCardToEmail).not.toHaveBeenCalled();
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("绑定失败不刷新邮箱状态", async () => {
        agent.bindEmailToAccount.mockResolvedValueOnce({ ok: false, message: "验证码无效或已过期" });
        render();
        testInputs()[0].value = "user@example.com";
        testInputs()[3].value = "000000";
        await click(4);
        expect(refresh).not.toHaveBeenCalled();
    });

    it("缺少邮箱或验证码时不发绑定请求", async () => {
        render();
        await click(4);
        expect(agent.bindEmailToAccount).not.toHaveBeenCalled();
        testInputs()[0].value = "user@example.com";
        await click(4);
        expect(agent.bindEmailToAccount).not.toHaveBeenCalled();
    });
});
