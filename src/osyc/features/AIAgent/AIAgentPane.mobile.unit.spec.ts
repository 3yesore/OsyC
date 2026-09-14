import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const paneSource = readFileSync(
    fileURLToPath(new URL("./AIAgentPane.svelte", import.meta.url)),
    "utf8"
);
const floatingSource = readFileSync(
    fileURLToPath(new URL("./AIAgentFloating.ts", import.meta.url)),
    "utf8"
);
const paneViewSource = readFileSync(
    fileURLToPath(new URL("./AIAgentPaneView.ts", import.meta.url)),
    "utf8"
    );
const assistantSource = readFileSync(
    fileURLToPath(new URL("./AIAgentAssistantMessage.svelte", import.meta.url)),
    "utf8"
);
const agentUiSource = readFileSync(
    fileURLToPath(new URL("../../serviceFeatures/useAIAgentUI.ts", import.meta.url)),
    "utf8"
);
const pluginStyles = readFileSync(
    fileURLToPath(new URL("../../../../styles.css", import.meta.url)),
    "utf8"
);
const themeStyles = pluginStyles.slice(pluginStyles.indexOf("/* OsyC AI theme tokens */"));

describe("AI 面板移动端底部输入区", () => {
    it("诊断信息使用构建注入的插件版本，不硬编码旧版本", () => {
        expect(paneSource).toContain("MANIFEST_VERSION");
        expect(paneSource).not.toContain('const currentPluginVersion = "1.0.58"');
    });

    it("审核稿布局保留完整接口并以会话侧栏为主导航", () => {
        for (const prop of [
            "tasks", "agentState", "isMock", "onSend", "onActivate", "onClear", "onOpenFile",
            "onOpenSettings", "onDeactivate", "onOpenAccount", "onCloudBackup", "onCloudRestore",
            "onLoadCloudVault", "onRetryPush", "onRecharge", "onApplySettingsPatch",
            "onApplyThemeSnippet", "onMarkOnboarded",
        ]) expect(paneSource).toContain(`${prop}:`);
        expect(paneSource).toContain('class="ai-shell"');
        expect(paneSource).toContain('class="ai-sidebar"');
        expect(paneSource).toContain('class="ai-session-list"');
        expect(paneSource).toContain('class="ai-chat-timeline"');
        expect(paneSource).toContain('class="ai-sidebar-actions"');
    });

    it("会话侧栏承载设置、权益、充值和调试入口，顶部不再重复挂载", () => {
        expect(paneSource).toContain('data-sidebar-action="settings"');
        expect(paneSource).toContain('data-sidebar-action="account"');
        expect(paneSource).toContain('data-sidebar-action="recharge"');
        expect(paneSource).toContain('data-sidebar-action="debug"');
        expect(paneSource).not.toContain('class="ai-status-actions"');
    });

    it("不显示会话搜索或相似笔记快捷项", () => {
        expect(paneSource).not.toMatch(/搜索会话|找出重复或高度相似的笔记|找出相似笔记/);
        expect(paneSource).not.toContain("ai-session-search");
    });

    it("助手回复在聊天时间线中直接展示，Artifact 和过程事件仍可见", () => {
        expect(paneSource).toContain('class="ai-message ai-message-assistant"');
        expect(paneSource).toContain("AIAgentAssistantMessage");
        expect(paneSource).not.toContain("AIAgentTaskCard");
    });

    it("用户消息和 OC 消息使用不同语义渲染，过程摘要不包裹正文", () => {
        expect(assistantSource).toContain("ai-assistant-message");
        expect(assistantSource).toContain("ai-assistant-content");
        expect(assistantSource).toContain("ai-assistant-activity");
        expect(assistantSource).toContain("ai-assistant-artifact");
        expect(assistantSource).not.toContain("ai-task-card");
        expect(assistantSource).not.toContain("max-height: min(44vh, 520px)");
    });

    it("聊天时间线按旧到新排列，并默认跟随最新消息到底部", () => {
        expect(paneSource).toContain("sort((a, b) => a.createdAt - b.createdAt)");
        expect(paneSource).toContain("timelineEl.scrollTop = timelineEl.scrollHeight");
    });

    it("输入区属于页面 flex 布局并预留 Obsidian 底栏高度", () => {
        expect(paneSource).not.toContain("position: sticky;");
        expect(paneSource).toContain("flex-shrink: 0;");
        expect(paneSource).toContain("max(8px, env(safe-area-inset-bottom))");
    });

    it("基础档用户不应在主任务流里看到 Cloud-Vault，聚焦也不能滚动整页", () => {
        expect(paneSource).toContain(
            '{#if activated && ($agentState.plan === "member" || $agentState.plan === "pro") && $agentState.cloudVault.available}'
        );
        expect(paneSource).not.toContain("scrollIntoView({ block: \"center\"");
        expect(paneSource).not.toContain("onfocus={scrollIntoViewOnKeyboard}");
    });

    it("多个发送中的临时任务不会共享 keyed each 的空 taskId", () => {
        expect(paneSource).toContain("{#each $tasks as task}");
        expect(paneSource).not.toContain("{#each $tasks as task (task.taskId)}");
    });

    it("悬浮球只打开主 Agent 页，不再挂载独立抽屉", () => {
        expect(floatingSource).toContain("window.visualViewport");
        expect(floatingSource).toContain("document.body.createDiv");
        expect(floatingSource).toContain('const FLOATING_ROOT_ID = "osyc-ai-floating-ball"');
        expect(floatingSource).toContain('attr: { id: FLOATING_ROOT_ID }');
        expect(floatingSource).toContain("osycFloatingCleanup");
        expect(floatingSource).not.toContain("this.app.workspace.containerEl.append");
        expect(floatingSource).not.toContain("ai-float-sheet");
        expect(floatingSource).toContain("onOpenPane");
        expect(paneSource).not.toContain("window.visualViewport");
        expect(paneSource).not.toContain("--ai-viewport-height");
        expect(paneSource).toContain("height: 100%;");
    });

    it("清理早期版本遗留的悬浮球和抽屉节点", () => {
        expect(floatingSource).toContain('.ai-float-root');
        expect(floatingSource).toContain('sheet-root');
        expect(floatingSource).toContain('querySelectorAll<HTMLElement>');
    });

    it("移动端输入区不再用固定 72px 把页面顶出键盘视口", () => {
        expect(paneSource).not.toContain("padding-bottom: calc(72px + env(safe-area-inset-bottom))");
        expect(paneSource).toContain("max(8px, env(safe-area-inset-bottom))");
    });

    it("Cloud-Vault 不可用时不应占用 Agent 输入区", () => {
        expect(paneSource).toContain(
            '{#if activated && ($agentState.plan === "member" || $agentState.plan === "pro") && $agentState.cloudVault.available}'
        );
    });

    it("移动端输入区只预留系统安全区，不人为制造底部工具栏空白", () => {
        expect(paneSource).not.toContain("--osyc-agent-bottom-toolbar");
        expect(paneSource).toContain("padding-bottom: max(8px, env(safe-area-inset-bottom));");
        expect(paneSource).not.toContain("position: sticky;");
    });

    it("键盘不驱动窗口级视口高度，Agent 只依赖宿主自然收缩", () => {
        expect(paneSource).not.toContain("window.visualViewport");
        expect(paneSource).not.toContain("--ai-viewport-height");
        expect(paneSource).not.toContain("getBoundingClientRect().top");
        expect(paneSource).not.toContain("--osyc-ai-bottom-inset");
        expect(paneSource).not.toContain("preventScroll: true");
        expect(paneSource).not.toContain("host.style.height");
        expect(paneSource).not.toContain("host.style.overflow");
    });

    it("Agent view 的宿主容器本身不参与键盘滚动", () => {
        expect(pluginStyles).toContain('.workspace-leaf-content[data-type="livesync-ai-agent"]');
        expect(pluginStyles).toContain('.workspace-leaf-content[data-type="livesync-ai-agent"] > .view-content');
        expect(pluginStyles).toContain("overflow: hidden");
        expect(pluginStyles).toContain("min-height: 0");
    });

    it("Agent 只在内部任务列表滚动，不改写宿主滚动属性", () => {
        expect(paneSource).not.toContain("previousOverflow");
        expect(paneSource).toContain(".ai-task-list");
    });

    it("无键盘时移动端聊天区也必须填满 Agent 页面，输入框固定在底部", () => {
        expect(paneSource).toContain(".ai-chat { height: 100%; }");
        expect(paneSource).toContain(".ai-chat-timeline, .ai-task-list");
        expect(paneSource).toContain(".ai-composer { flex: 0 0 auto;");
    });

    it("顶部状态卡不得显示模型或人民币额度", () => {
        expect(paneSource).not.toContain('<span class="ai-meta-key">模型</span>');
        expect(paneSource).not.toContain('<span class="ai-meta-key">模型额度</span>');
    });

    it("B 路线提供稳定的 OsyC 主题变量命名空间", () => {
        expect(paneSource).toContain('class="ai-pane osyc-ai-agent"');
        expect(themeStyles).toContain(".osyc-ai-agent {");
        expect(themeStyles).toContain("--osyc-ai-font-family");
        expect(themeStyles).toContain("--osyc-ai-font-size");
        expect(themeStyles).toContain("--osyc-ai-background-image");
        expect(themeStyles).toContain("--osyc-ai-content-width");
        expect(themeStyles).toContain(
            "--osyc-ai-surface-alt: var(--background-secondary-alt, var(--background-secondary));"
        );
        expect(paneSource).toContain(
            "background-color: var(--osyc-ai-surface-alt, var(--background-secondary));"
        );
    });

    it("主题变量只挂在 OsyC 命名空间，不污染 Obsidian 宿主", () => {
        expect(themeStyles).not.toMatch(/(^|\n)\s*(body|\.workspace|\.app-container)\s*\{/);
        expect(themeStyles).toContain(".osyc-ai-agent .ai-assistant-message");
    });

    it("混排内容在窄屏下允许长链接换行并限制图片尺寸", () => {
        expect(themeStyles).toContain(".osyc-ai-agent .ai-rich-content");
        expect(themeStyles).toContain("overflow-wrap: anywhere");
        expect(themeStyles).toContain("max-width: 100%");
        expect(themeStyles).toContain("object-fit: contain");
    });

    it("提供外观与调试入口及脱敏诊断操作", () => {
        expect(paneSource).toContain('title="外观与调试"');
        expect(paneSource).toContain("复制脱敏诊断");
        expect(paneSource).toContain("buildAppearanceDiagnostics");
        expect(themeStyles).toContain(".osyc-ai-agent .ai-debug-panel");
    });

    it("手机端可以从命令面板打开并复制 OsyC 自己的日志", () => {
        expect(agentUiSource).toContain('id: "open-osyc-log"');
        expect(agentUiSource).toContain('name: "打开日志"');
        expect(agentUiSource).toContain('id: "copy-osyc-log"');
        expect(paneSource).toContain("复制脱敏诊断");
        expect(paneViewSource).toContain("osycLogger.error");
    });

    it("视图挂载重试不依赖 WebView 一定提供 requestAnimationFrame", () => {
        expect(paneViewSource).toContain("typeof window.requestAnimationFrame === \"function\"");
        expect(paneViewSource).toContain("页面重试挂载失败");
    });

    it("外观数值和颜色使用原生滑块/颜色选择器，不要求手机手填 CSS 值", () => {
        const settingsSource = readFileSync(
            fileURLToPath(new URL("../../serviceFeatures/useAIAgentUI.ts", import.meta.url)),
            "utf8"
        );
        expect(settingsSource).toContain(".addSlider((slider) => slider.setLimits(13, 24, 1)");
        expect(settingsSource).toContain(".addColorPicker((picker)");
        expect(settingsSource).not.toContain('setDesc("支持 #RGB/#RRGGBB；留空跟随预设")');
    });
});
