import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * 2.0.17 诊断覆盖回归。
 *
 * 用户现场反馈「插件里的 OsyC diagnostic log 只有 1 条」：健康路径上只有
 * refreshRuntimeInfo 那一句指纹 INFO，关键流程全靠 console.* 或干脆不记。
 * 这里把「必须记日志」的流程逐条钉住，少一处就红。
 *
 * 日志文案是接口的一部分（用户靠它定位现场），因此断言字面量而不是行为代理。
 */
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const ui = read("./useAIAgentUI.ts");
const agent = read("../features/AIAgent/CmdAIAgent.ts");
const tools = read("../features/AIAgent/AIAgentToolsModal.ts");

describe("关键流程日志覆盖（2.0.17）", () => {
    const agentCases: [string, string][] = [
        ["激活开始", 'osycLogger.info("OsyC 激活开始"'],
        ["激活失败", 'osycLogger.warn("OsyC 激活失败"'],
        ["激活成功", 'osycLogger.info("OsyC 激活成功"'],
        ["API 4xx/5xx 摘要入缓冲", "osycLogger.recordApiFailure("],
        ["API 4xx/5xx 日志", 'osycLogger.warn("OsyC API 请求失败"'],
        ["Pro 开通开始", 'osycLogger.info("OsyC Pro 独立空间开通开始"'],
        ["Pro 回读自检失败", 'osycLogger.warn("OsyC Pro 独立空间回读自检失败"'],
        ["Pro 开通成功", 'osycLogger.info("OsyC Pro 独立空间已切换"'],
        ["邮箱验证码已发送", 'osycLogger.info("OsyC 邮箱验证码已发送"'],
        ["邮箱验证码失败", 'osycLogger.warn("OsyC 邮箱验证码发送失败"'],
        ["邮箱登录成功", 'osycLogger.info("OsyC 邮箱登录成功"'],
        ["邮箱登录失败", 'osycLogger.warn("OsyC 邮箱登录失败"'],
        ["卡密并入邮箱成功", 'osycLogger.info("OsyC 卡密并入邮箱成功"'],
        ["卡密并入邮箱失败", 'osycLogger.warn("OsyC 卡密并入邮箱失败"'],
        ["卡密绑定邮箱成功", 'osycLogger.info("OsyC 卡密绑定邮箱成功"'],
        ["卡密绑定邮箱失败", 'osycLogger.warn("OsyC 卡密绑定邮箱失败"'],
    ];
    for (const [flow, literal] of agentCases) {
        it(`CmdAIAgent 在「${flow}」写日志`, () => expect(agent).toContain(literal));
    }

    const uiCases: [string, string][] = [
        ["setup URI 应用开始", 'osycLogger.info("OsyC setup URI 应用开始"'],
        ["setup URI 解码失败", 'osycLogger.warn("OsyC setup URI 解码失败"'],
        ["setup URI 回读自检失败", 'osycLogger.warn("OsyC setup URI 回读自检失败"'],
        ["setup URI 应用成功", 'osycLogger.info("OsyC setup URI 应用成功"'],
        ["setup URI 应用异常", 'osycLogger.warn("OsyC setup URI 应用异常"'],
        ["同步配置自愈", "osycLogger.info(`同步配置自愈（${source}）`"],
        ["LiveSync 拉取开始", '"OsyC LiveSync 拉取开始"'],
        ["LiveSync 拉取完成", '"OsyC LiveSync 拉取完成"'],
        ["LiveSync 推送完成", '"OsyC LiveSync 推送完成"'],
        ["LiveSync 同步失败", '"OsyC LiveSync 同步失败"'],
        ["加入远端里程碑", '"OsyC 已加入远端里程碑"'],
    ];
    for (const [flow, literal] of uiCases) {
        it(`useAIAgentUI 在「${flow}」写日志`, () => expect(ui).toContain(literal));
    }

    it("工具中心提供可用的诊断上传入口，并接入真实上传端口", () => {
        expect(tools).toContain('setName("上传脱敏诊断")');
        expect(tools).toContain("this.uploadDiagnostics");
        expect(tools).toContain("createManualDiagnosticTask()");
        expect(ui).toContain("uploadErrorReport(agent.settings.apiBase");
    });

    it("上传上下文采集账户档位、LiveSync 摘要、API 失败摘要与完整日志", () => {
        expect(ui).toContain("accountSummary: account");
        expect(ui).toContain("livesyncSummary: buildLiveSyncDiagnosticSummary(");
        expect(ui).toContain("apiFailures: osycLogger.apiFailures()");
        expect(ui).toContain("diagnosticsLog: osycLogger.report()");
    });
});
