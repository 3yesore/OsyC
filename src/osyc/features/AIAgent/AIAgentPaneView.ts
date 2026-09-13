import type { WorkspaceLeaf } from "@/deps.ts";
import { mount } from "svelte";
import { SvelteItemView } from "@/common/SvelteItemView.ts";
import AIAgentPaneComponent from "./AIAgentPane.svelte";
import type { AISnippet, CmdAIAgent } from "./CmdAIAgent";
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
    openSettings: () => void;
    onDeactivate: () => void;
    onOpenAccount: () => void;
    onCloudBackup: () => Promise<{ ok: boolean; message: string }>;
    onCloudRestore: (snapshotId: string, overwrite: boolean) => Promise<{ ok: boolean; message: string }>;
    onLoadCloudVault: () => void;
    onApplySettingsPatch: (patch: Record<string, unknown>) => Promise<{ applied: number; rejected: { key: string; reason: string }[] }>;
    onApplyThemeSnippet: (snippet: AISnippet) => Promise<{ ok: boolean; message: string }>;
    onMarkOnboarded: () => void;

    override icon = "bot";
    // Agent is a first-class page in the main workspace. Keeping navigation=true
    // prevents Obsidian from placing it in the right sidebar and shifting notes.
    override navigation = true;
    title = "OC";

    constructor(
        leaf: WorkspaceLeaf,
        agent: CmdAIAgent,
        openFile: (path: string) => void,
        openSettings: () => void,
        onDeactivate: () => void,
        onOpenAccount: () => void,
        onCloudBackup: () => Promise<{ ok: boolean; message: string }>,
        onCloudRestore: (snapshotId: string, overwrite: boolean) => Promise<{ ok: boolean; message: string }>,
        onLoadCloudVault: () => void,
        onApplySettingsPatch: (patch: Record<string, unknown>) => Promise<{ applied: number; rejected: { key: string; reason: string }[] }>,
        onApplyThemeSnippet: (snippet: AISnippet) => Promise<{ ok: boolean; message: string }>,
        onMarkOnboarded: () => void
    ) {

        super(leaf);
        this.agent = agent;
        this.openFile = openFile;
        this.openSettings = openSettings;
        this.onDeactivate = onDeactivate;
        this.onOpenAccount = onOpenAccount;
        this.onCloudBackup = onCloudBackup;
        this.onCloudRestore = onCloudRestore;
        this.onLoadCloudVault = onLoadCloudVault;
        this.onApplySettingsPatch = onApplySettingsPatch;
        this.onApplyThemeSnippet = onApplyThemeSnippet;
        this.onMarkOnboarded = onMarkOnboarded;
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

    instantiateComponent(target: HTMLElement) {
        return mount(AIAgentPaneComponent, {
            target: target,
            props: {
                app: this.app,
                tasks: this.agent.tasks,
                agentState: this.agent.state,
                isMock: this.agent.isMock,
                onSend: (message: string): void => void this.agent.send(message),
                onActivate: (cardKey: string) => this.agent.activate(cardKey),
                onClear: () => this.agent.clearFinished(),
                onOpenFile: (path: string) => this.openFile(path),
                onOpenSettings: () => this.openSettings(),
                onDeactivate: () => this.onDeactivate(),
                onOpenAccount: () => this.onOpenAccount(),
                onCloudBackup: () => this.agent.cloudBackup(),
                onCloudRestore: (snapshotId: string, overwrite: boolean) => this.agent.cloudRestore(snapshotId, overwrite),
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
                onRecharge: (cardKey: string) => this.agent.recharge(cardKey),
            },
        });
    }
}
