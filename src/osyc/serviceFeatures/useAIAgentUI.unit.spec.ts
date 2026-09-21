import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./useAIAgentUI.ts", import.meta.url)), "utf8");
const settingsPane = readFileSync(
    fileURLToPath(new URL("../features/AIAgent/osycSettingsPane.ts", import.meta.url)),
    "utf8"
);
const settingsController = readFileSync(
    fileURLToPath(new URL("../features/AIAgent/osycSettingsController.ts", import.meta.url)),
    "utf8"
);
const styles = readFileSync(fileURLToPath(new URL("../../../styles.css", import.meta.url)), "utf8");

describe("OsyC 设置页信息架构", () => {
    it("设置页按连接、外观、交互、诊断四组呈现", () => {
        expect(settingsPane).toContain('addPane(paneEl, "连接"');
        expect(settingsPane).toContain('addPane(paneEl, "外观"');
        expect(settingsPane).toContain('addPane(paneEl, "交互"');
        expect(settingsPane).toContain('addPane(paneEl, "诊断"');
    });

    it("连接分组位于外观之前，交互与诊断依次靠后", () => {
        const connection = settingsPane.indexOf('addPane(paneEl, "连接"');
        const appearance = settingsPane.indexOf('addPane(paneEl, "外观"');
        const interaction = settingsPane.indexOf('addPane(paneEl, "交互"');
        const diagnostics = settingsPane.indexOf('addPane(paneEl, "诊断"');
        expect(connection).toBeGreaterThan(-1);
        expect(appearance).toBeGreaterThan(connection);
        expect(interaction).toBeGreaterThan(appearance);
        expect(diagnostics).toBeGreaterThan(interaction);
    });

    it("设置改为原生设置页承载，不再保留自建设置弹窗", () => {
        expect(source).not.toContain("class AIAgentSettingModal");
        expect(source).not.toContain("AIAgentSettingModal(");
        expect(settingsController).toContain("setOsycSettingsController");
        expect(settingsPane).toContain("getOsycSettingsController");
    });

    it("设置页只读快照并回写运行时，不自己保存第二份状态", () => {
        expect(settingsPane).toContain("controller.snapshot()");
        expect(settingsPane).toContain("controller.setAppearance");
        expect(settingsPane).toContain("controller.importFont");
        expect(settingsPane).not.toContain("localStorage");
    });

    it("保持底部栏入口与命令命名", () => {
        expect(source).toContain('api.addRibbonIcon("bot", "OC"');
        expect(source).toContain('name: "打开 OC 面板"');
        expect(source).not.toContain('name: "OC : 打开 OC 面板"');
    });

    it("不再使用不准确的模型选择升级承诺", () => {
        expect(source).not.toContain("更多模型选择");
        expect(settingsPane).not.toContain("更多模型选择");
    });

    it("不调用 Obsidian 已废弃的动态滑块提示 API", () => {
        expect(source).not.toContain(".setDynamicTooltip()");
        expect(settingsPane).not.toContain(".setDynamicTooltip()");
    });

    it("不保留未接入的当前笔记捕获闭包", () => {
        expect(source).not.toContain("const captureCurrentNote =");
    });

    it("主题片段不应自动启用，也不能覆盖 appearance.json 的其它设置", () => {
        expect(source).not.toContain("JSON.stringify({ cssSnippets: enabled }, null, 2)");
        expect(source).not.toContain("enabled.push(safeName)");
        expect(source).toContain("已保存主题片段");
        expect(source).toContain("请在设置 → 外观 → CSS 代码片段中手动启用");
    });

    it("主题模式变化时重新计算 OsyC 外观 token", () => {
        expect(source).toContain("MutationObserver");
        expect(source).toContain('attributeFilter: ["class"]');
        expect(source).toContain("themeObserver?.disconnect()");
    });

    it("exposes the shared broad font catalog for body and heading controls", () => {
        expect(settingsPane).toContain("fontOptionsForSources");
        expect(settingsPane).toContain("FONT_SOURCE_GROUPS");
        expect(settingsPane).toContain("headingFontSource");
        expect(settingsPane).toContain("codeFontSource");
        expect(settingsPane).toContain("标题字体");
        expect(settingsPane).toContain("代码字体");
    });

    it("外观高频项直接呈现，低频的颜色与背景收进可展开分组", () => {
        expect(settingsPane).toContain('createEl("details", { cls: "osyc-ai-appearance-advanced" })');
        expect(settingsPane).toContain('text: "更多颜色与背景"');
        expect(settingsPane).toContain("osyc-ai-appearance-advanced-content");
    });

    it("交互分组直接呈现三个开关，不再嵌套折叠层", () => {
        expect(settingsPane).toContain("悬浮球常驻显示");
        expect(settingsPane).toContain("移动端三击打开 OC");
        expect(settingsPane).toContain("发送时附带当前 Markdown 笔记");
        expect(settingsPane).not.toContain("osyc-ai-interaction-advanced");
    });

    it("在三个字体选择框下方渲染实时样例，并保持预览不使用内部滚动", () => {
        expect(settingsPane).toContain("osyc-font-preview");
        expect(settingsPane).toContain("正文字体预览");
        expect(settingsPane).toContain("标题字体预览");
        expect(settingsPane).toContain("代码字体预览");
        expect(styles).toContain(".osyc-ai-appearance-preview");
        expect(styles).toContain("overflow: visible");
        expect(styles).toContain(".osyc-font-preview");
    });

    it("设置页预览解析 Vault 资源 URL，使本地背景图可以实时显示", () => {
        expect(settingsPane).toContain("controller.resolveResourceUrl(appearance.background.vaultPath)");
        expect(settingsPane).toContain(
            "appearanceToCssVariables(appearance, resourceUrl, themeMode, controller.snapshot().fontResources)"
        );
        expect(source).toContain("app.vault.getResourcePath(file)");
    });

    it("提供 Vault 字体载入入口并注入字体资源样式", () => {
        expect(settingsPane).toContain("载入本地字体");
        expect(source).toContain("fontResourcePath");
        expect(source).toContain("adapter.writeBinary");
        expect(source).not.toContain('createElement("style")');
    });

    it("在导入和启动时显式挂载 FontFace，并在卸载时清理", () => {
        expect(source).toContain("createFontFaceDescriptor");
        expect(source).toContain("new FontFace(descriptor.family, descriptor.source, descriptor.descriptors)");
        expect(source).toContain("await face.load()");
        expect(source).toContain(".add(face)");
        expect(source).toContain("fontSet.delete(face)");
    });

    it("按自定义字体真实 family 检测可用性，并让代码字体也能选择本地资源", () => {
        expect(settingsPane).toContain("function fontOptionsWithAvailability(");
        expect(settingsPane).toContain("options: Record<string, string>,");
        expect(settingsPane).toContain("resources: readonly FontResource[] = []");
        expect(settingsPane).toContain("fontFamilyForSource(source as FontSource, resource?.family)");
        expect(settingsPane).toContain("{ ...CODE_FONT_OPTIONS, ...localFontOptions(");
        expect(settingsPane).toContain("localFontOptions(controller.snapshot().fontResources)");
        expect(settingsPane).toContain("fontSourceForResource(resource.id)");
    });

    it("恢复默认后把已渲染的控件同步回新值", () => {
        expect(settingsPane).toContain("const syncers: (() => void)[] = []");
        expect(settingsPane).toContain("const syncAll = () => {");
        expect(settingsPane).toContain("controller.resetAppearance()");
    });

    it("发布资产内置可直接使用的中文、拉丁和等宽字体资源", () => {
        expect(styles).toContain("@font-face");
        expect(styles).toContain('font-family: "Noto Sans SC"');
        expect(styles).toContain('font-family: "Inter"');
        expect(styles).toContain('font-family: "JetBrains Mono"');
        expect(styles).toContain("data:font/woff2;base64,");
    });

    it("设置页提供开源主题参考的内置预设", () => {
        expect(settingsPane).toContain("Minimal");
        expect(settingsPane).toContain("Chinese Writing");
        expect(settingsPane).toContain("CodeSplash");
        expect(settingsPane).toContain("Image Layouts");
        expect(settingsPane).toContain("THEME_PRESET_OPTIONS");
        expect(settingsPane).toContain("THEME_PACK_OPTIONS");
        expect(settingsPane).toContain("themePackScope");
    });

    it("服务地址停止输入后才落盘，避免逐字写文件", () => {
        expect(settingsPane).toContain("window.setTimeout(() => {");
        expect(settingsPane).toContain("controller.setServiceUrl(value.trim())");
        expect(source).toContain("agent.configure(value, agent.settings.token)");
    });
});

describe("激活流程的回读自检", () => {
    it("applySetupUri 在 applySettings() 之后回读设置，并校验活动远端档案", () => {
        const applyPartialAt = source.indexOf("await core.services.setting.applyPartial(mergedPatch, true);");
        const applySettingsAt = source.indexOf("await core.services.control.applySettings();", applyPartialAt);
        const verifyAt = source.indexOf(
            "verifyActivatedRemote(core.services.setting.currentSettings())",
            applySettingsAt
        );
        expect(applyPartialAt).toBeGreaterThan(-1);
        expect(applySettingsAt).toBeGreaterThan(applyPartialAt);
        expect(verifyAt).toBeGreaterThan(applySettingsAt);
    });

    it("复用纯函数 verifyActivatedRemote，而不是内联重复判定", () => {
        expect(source).toContain(
            'import { planProvisionedReplicationRepair, verifyActivatedRemote } from "@/osyc/features/AIAgent/livesyncActivation";'
        );
    });

    it("自检失败时 console.warn 明确中文原因并返回 false，让上层标为配置失败", () => {
        expect(source).toContain("if (!verification.ok) {");
        expect(source).toContain("console.warn(`激活后未生成可用的同步档案：${verification.reason}`)");
        // 不能自检失败还 return true（那正是「报告成功但没有任何远端」的现场形态）
        const warnAt = source.indexOf("console.warn(`激活后未生成可用的同步档案：${verification.reason}`)");
        const failAt = source.indexOf("return false;", warnAt);
        expect(failAt).toBeGreaterThan(warnAt);
    });

    it("回读自检之外的异常也要 console.warn，不能静默 return false", () => {
        const warnLiteral = 'console.warn("激活写入同步配置时异常，已按配置失败处理")';
        expect(source).toContain(warnLiteral);
        // 先留日志再按配置失败返回，语义仍是 false（不改返回值）
        const warnAt = source.indexOf(warnLiteral);
        const failAt = source.indexOf("return false;", warnAt);
        expect(failAt).toBeGreaterThan(warnAt);
    });
});

describe("启动自愈的日志文案", () => {
    it("按本次实际修补内容拼接，不再固定写「已补开 LiveSync 同步开关」", () => {
        // 自愈现在也可能只纠正 customChunkSize（不补开关）；固定文案会把
        // 「只改了分块参数」误报成「补开了总开关」，所以必须按 repair 内容拼。
        expect(source).not.toContain("已补开 LiveSync 同步开关（激活自愈）");
        expect(source).toContain("repair.liveSync === true");
        expect(source).toContain("repair.customChunkSize !== undefined");
        expect(source).toContain('osycLogger.info(`激活自愈：${repairs.join("；")}`)');
    });
});
