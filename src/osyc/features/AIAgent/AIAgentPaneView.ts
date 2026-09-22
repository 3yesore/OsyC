import type { WorkspaceLeaf } from "@/deps.ts";
import { mount } from "svelte";
import { SvelteItemView } from "@/common/SvelteItemView.ts";
import AIAgentPaneComponent from "./AIAgentPane.svelte";
import type { AISnippet, CmdAIAgent } from "./CmdAIAgent";
import { captureActiveNoteFromApp } from "./activeNoteBridge";
import type { ActiveNoteSnapshot } from "./activeNoteContext";
import type { Writable } from "svelte/store";
import { osycLogger } from "@/osyc/serviceFeatures/osycLogger";

export const VIEW_TYPE_AI_AGENT = "livesync-ai-agent";

/**
 * AI 代执行面板。
 *
 * 与 P2P 面板同一套模式：继承 SvelteItemView，把 Svelte 组件挂到 Obsidian 主工作区标签页。
 * 所有业务逻辑都在 CmdAIAgent 里，这里只做桥接。
 */
export class AIAgentPaneView extends SvelteItemView {
    agent: CmdAIAgent;
    openFile: (path: string) => void;
    onDeactivate: () => void;
    onOpenTools: () => void;
    onLoadCloudVault: () => void;
    onApplySettingsPatch: (patch: Record<string, unknown>) => Promise<{ applied: number; rejected: { key: string; reason: string }[] }>;
    onApplyThemeSnippet: (snippet: AISnippet) => Promise<{ ok: boolean; message: string }>;
    onMarkOnboarded: () => void;
    onUploadDiagnostics: (task: import("./CmdAIAgent").AITask) => Promise<{ ok: boolean; message: string }>;
    unreadAnnouncements: Writable<number>;
    onOpenAnnouncements: () => void;
    onOpenAccount: () => void;
    /**
     * 面板打开时的同步配置自愈钩子（可选）。
     *
     * 「打开插件面板时」是 2.0.19 要求的四个自愈时机之一：设备一上线就先对齐官方
     * 托管远端的同步参数，用户看不到那句「拉取失败」和 mismatch 提示。
     * 只做同步配置事务，不参与渲染，失败也不会影响挂载。
     */
    onPaneOpened?: () => void;

    override icon = "bot";
    // Agent is a first-class page in the main workspace. Keeping navigation=true
    // prevents Obsidian from placing it in the right sidebar and shifting notes.
    override navigation = true;
    title = "OC";

    constructor(
        leaf: WorkspaceLeaf,
        agent: CmdAIAgent,
        openFile: (path: string) => void,
        onDeactivate: () => void,
        onOpenTools: () => void,
        onLoadCloudVault: () => void,
        onApplySettingsPatch: (patch: Record<string, unknown>) => Promise<{ applied: number; rejected: { key: string; reason: string }[] }>,
        onApplyThemeSnippet: (snippet: AISnippet) => Promise<{ ok: boolean; message: string }>,
        onMarkOnboarded: () => void,
        onUploadDiagnostics: (task: import("./CmdAIAgent").AITask) => Promise<{ ok: boolean; message: string }>,
        unreadAnnouncements: Writable<number>,
        onOpenAnnouncements: () => void,
        onOpenAccount: () => void
    ) {

        super(leaf);
        this.agent = agent;
        this.openFile = openFile;
        this.onDeactivate = onDeactivate;
        this.onOpenTools = onOpenTools;
        this.onLoadCloudVault = onLoadCloudVault;
        this.onApplySettingsPatch = onApplySettingsPatch;
        this.onApplyThemeSnippet = onApplyThemeSnippet;
        this.onMarkOnboarded = onMarkOnboarded;
        this.onUploadDiagnostics = onUploadDiagnostics;
        this.unreadAnnouncements = unreadAnnouncements;
        this.onOpenAnnouncements = onOpenAnnouncements;
        this.onOpenAccount = onOpenAccount;
    }

    override getIcon(): string {
        return "bot";
    }

    getViewType() {
        return VIEW_TYPE_AI_AGENT;
    }

    getDisplayText() {
        return "OC";
    }

    override async onOpen(): Promise<void> {
        this.onPaneOpened?.();
        try {
            await super.onOpen();
        } catch (error) {
            // Obsidian otherwise leaves a completely blank ItemView when a
            // Svelte component throws during mount. Keep the failure visible
            // and actionable on mobile, while retaining the full stack in logs.
            osycLogger.error("OsyC 页面挂载失败", error);
            console.error("OsyC 页面挂载失败", error);
            // A mobile workspace can deliver onOpen before its content box has
            // settled. Give Svelte one frame to retry before showing the error.
            await new Promise<void>((resolve) => {
                if (typeof window.requestAnimationFrame === "function") {
                    window.requestAnimationFrame(() => resolve());
                } else {
                    window.setTimeout(resolve, 0);
                }
            });
            try {
                this.contentEl.empty();
                await this._dismountComponent();
                this.component = this.instantiateComponent(this.contentEl);
                return;
            } catch (retryError) {
                osycLogger.error("OsyC 页面重试挂载失败", retryError);
                console.error("OsyC 页面重试挂载失败", retryError);
            }
            this.renderMountError();
        }
    }

    private renderMountError(): void {
        this.contentEl.empty();
        const panel = this.contentEl.createDiv({ cls: "osyc-ai-agent-mount-error" });
        panel.createEl("strong", { text: "OC 页面暂时无法打开" });
        panel.createEl("p", { text: "请关闭此标签后重新打开；如果仍失败，请在命令面板执行“打开 OsyC 日志”。" });
    }

    /**
     * 发送前把用户此刻正在看的笔记快照一起上行。
     *
     * 取不到（没开笔记、不是 Markdown、超出上限、设备不支持加密）就按原样发送：
     * 上下文是增益，绝不能因为它失败而挡住用户的提问。服务端只在这一条消息里使用它，
     * 不回传、不进任务接口。
     */
    private async sendWithContext(message: string): Promise<void> {
        let snapshot: ActiveNoteSnapshot | undefined;
        try {
            const result = await captureActiveNoteFromApp(this.app);
            snapshot = result.snapshot;
            if (result.error) {
                osycLogger.warn("活动笔记快照未附带：" + result.error);
            }
        } catch (error) {
            osycLogger.warn("活动笔记快照采集失败，改为不带上下文发送", error);
        }
        void this.agent.send(message, snapshot);
    }

    instantiateComponent(target: HTMLElement) {
        return mount(AIAgentPaneComponent, {
            target: target,
            props: {
                app: this.app,
                tasks: this.agent.tasks,
                agentState: this.agent.state,
                isMock: this.agent.isMock,
                onSend: (message: string): void => void this.sendWithContext(message),
                onActivate: (cardKey: string) => this.agent.activate(cardKey),
                onClear: () => this.agent.clearFinished(),
                onOpenFile: (path: string) => this.openFile(path),
                onDeactivate: () => this.onDeactivate(),
                onOpenTools: () => this.onOpenTools(),
                onLoadCloudVault: (): void => {
                    void this.agent.loadCloudVault();
                },
                onApplySettingsPatch: (patch: Record<string, unknown>) =>
                    this.onApplySettingsPatch(patch),
                onApplyThemeSnippet: (snippet: AISnippet) => this.onApplyThemeSnippet(snippet),
                onMarkOnboarded: () => this.onMarkOnboarded(),
                onRetryPush: (taskId: string): void => void this.agent.retryPush(taskId),
                onConfirmTask: (taskId: string) => this.agent.confirmTask(taskId),
                onCancelConfirmation: (taskId: string) => this.agent.cancelConfirmation(taskId),
                onUploadDiagnostics: (task: import("./CmdAIAgent").AITask) => this.onUploadDiagnostics(task),
                unreadAnnouncements: this.unreadAnnouncements,
                onOpenAnnouncements: () => this.onOpenAnnouncements(),
                onOpenAccount: () => this.onOpenAccount(),
            },
        });
    }
}
