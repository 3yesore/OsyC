import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(
    fileURLToPath(new URL("./CmdAIAgent.ts", import.meta.url)),
    "utf8"
);

describe("Agent 确认状态机客户端契约", () => {
    it("支持待确认、冲突、取消和交付失败状态", () => {
        expect(source).toContain('"awaiting_confirmation"');
        expect(source).toContain('"conflict"');
        expect(source).toContain('"cancelled"');
        expect(source).toContain('"delivery_failed"');
    });

    it("轮询模型包含确认摘要和一次性令牌字段", () => {
        expect(source).toContain("confirmation?: ConfirmationPrompt");
        expect(source).toContain("summary_sha256");
        expect(source).toContain("expires_at");
    });

    it("提供确认和取消接口且不重新发送模型任务", () => {
        expect(source).toContain("async confirmTask(");
        expect(source).toContain("async cancelConfirmation(");
        expect(source).toContain("/confirm");
        expect(source).toContain("/cancel-confirmation");
        expect(source).not.toContain("this.send(");
    });
});
