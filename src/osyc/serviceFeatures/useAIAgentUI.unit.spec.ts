import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(
    fileURLToPath(new URL("./useAIAgentUI.ts", import.meta.url)),
    "utf8"
);
const styles = readFileSync(
    fileURLToPath(new URL("../../../styles.css", import.meta.url)),
    "utf8"
);

describe("OsyC 设置页信息架构", () => {
    it("明确分组连接、笔记内容外观和 OC 交互", () => {
        expect(source).toContain('text: "连接"');
        expect(source).toContain('text: "笔记内容外观"');
        expect(source).toContain('text: "OC 交互"');
        expect(source).toContain('api.addRibbonIcon("bot", "OC"');
        expect(source).toContain('name: "OC : 打开 OC 面板"');
    });

    it("连接分组位于笔记外观之前，交互分组位于外观之后", () => {
        const connection = source.indexOf('text: "连接"');
        const appearance = source.indexOf('text: "笔记内容外观"');
        const interaction = source.indexOf('text: "OC 交互"');
        expect(connection).toBeGreaterThan(-1);
        expect(appearance).toBeGreaterThan(connection);
        expect(interaction).toBeGreaterThan(appearance);
    });

    it("不再使用不准确的模型选择升级承诺", () => {
        expect(source).not.toContain("更多模型选择");
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
        expect(source).toContain("fontOptionsForSources");
        expect(source).toContain("FONT_SOURCE_GROUPS");
        expect(source).toContain("headingFontSource");
        expect(source).toContain("codeFontSource");
        expect(source).toContain("标题字体");
        expect(source).toContain("代码字体");
    });

    it("将外观设置分为快速调整和可展开的详细调整", () => {
        expect(source).toContain('text: "快速调整"');
        expect(source).toContain('text: "详细调整"');
        expect(source).toContain("osyc-ai-appearance-advanced");
    });

    it("将 OC 交互设置收进独立的可展开分组", () => {
        expect(source).toContain("osyc-ai-interaction-advanced");
        expect(source).toContain('text: "OC 交互"');
        expect(styles).toContain(".osyc-ai-interaction-advanced");
        expect(styles).toContain(".osyc-ai-interaction-content");
    });

    it("在三个字体选择框下方渲染实时样例，并保持预览不使用内部滚动", () => {
        expect(source).toContain("osyc-font-preview");
        expect(source).toContain("正文字体预览");
        expect(source).toContain("标题字体预览");
        expect(source).toContain("代码字体预览");
        expect(styles).toContain(".osyc-ai-appearance-preview");
        expect(styles).toContain("overflow: visible");
        expect(styles).toContain(".osyc-font-preview");
    });

    it("设置页预览解析 Vault 资源 URL，使本地背景图可以实时显示", () => {
        expect(source).toContain("const backgroundFile = this.appearance.background.vaultPath");
        expect(source).toContain("app.vault.getResourcePath(backgroundFile)");
        expect(source).toContain("appearanceToCssVariables(this.appearance, resourceUrl, themeMode, this.fontResources)");
    });

    it("提供 Vault 字体载入入口并注入字体资源样式", () => {
        expect(source).toContain("载入本地字体");
        expect(source).toContain("buildFontFaceStyles");
        expect(source).toContain("fontResourcePath");
        expect(source).toContain("adapter.writeBinary");
        expect(source).toContain("osyc-ai-font-resources-style");
    });

    it("在导入和启动时显式挂载 FontFace，并在卸载时清理", () => {
        expect(source).toContain("createFontFaceDescriptor");
        expect(source).toContain("new FontFace(descriptor.family, descriptor.source, descriptor.descriptors)");
        expect(source).toContain("await face.load()");
        expect(source).toContain(".add(face)");
        expect(source).toContain("fontSet.delete(face)");
    });

    it("按自定义字体真实 family 检测可用性，并让代码字体也能选择本地资源", () => {
        expect(source).toContain("fontOptionsWithAvailability(options: Record<string, string>, resources: readonly FontResource[] = [])");
        expect(source).toContain("fontFamilyForSource(source as FontSource, resource?.family)");
        expect(source).toContain("fontOptionsWithAvailability({ ...CODE_FONT_OPTIONS");
        expect(source).toContain("this.fontResources.map((resource) => [fontSourceForResource(resource.id)");
    });

    it("发布资产内置可直接使用的中文、拉丁和等宽字体资源", () => {
        expect(styles).toContain("@font-face");
        expect(styles).toContain("font-family: \"Noto Sans SC\"");
        expect(styles).toContain("font-family: \"Inter\"");
        expect(styles).toContain("font-family: \"JetBrains Mono\"");
        expect(styles).toContain("data:font/woff2;base64,");
    });

    it("设置页提供开源主题参考的内置预设", () => {
        expect(source).toContain("Minimal");
        expect(source).toContain("Chinese Writing");
        expect(source).toContain("CodeSplash");
        expect(source).toContain("Image Layouts");
        expect(source).toContain("THEME_PRESET_OPTIONS");
        expect(source).toContain("THEME_PACK_OPTIONS");
        expect(source).toContain("themePackScope");
    });
});
