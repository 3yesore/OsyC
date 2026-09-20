import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./CmdAIAgent.ts", import.meta.url)), "utf8");

/**
 * 状态码文案的正确性：403 是「本档位设备数已满」，不是固定的 3 台。
 * 档位上限随订阅变化（base 2 / member 5 / pro 10），文案写死台数会误导用户。
 */
describe("CmdAIAgent 状态码文案", () => {
    it("403 不再硬编码设备台数，改为按档位表述", () => {
        expect(source).not.toContain("设备数量超限（最多 3 台）");
        expect(source).toContain("设备数量已达本档位上限，请在账户弹窗里解绑旧设备");
    });
});
