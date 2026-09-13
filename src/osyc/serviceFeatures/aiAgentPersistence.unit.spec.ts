import { describe, expect, it } from "vitest";
import { parseAIAgentPersisted, PERSISTED_VERSION } from "./aiAgentPersistence";
import { DEFAULT_APPEARANCE } from "@/osyc/features/AIAgent/appearance";

describe("aiAgentPersistence", () => {
    it("损坏或非对象 JSON 降级为空配置", () => {
        expect(parseAIAgentPersisted("not-json")).toEqual({ version: PERSISTED_VERSION });
        expect(parseAIAgentPersisted("[]")).toEqual({ version: PERSISTED_VERSION });
    });

    it("读取并清洗 appearance，而旧配置使用默认外观", () => {
        expect(parseAIAgentPersisted("{}").appearance).toEqual(DEFAULT_APPEARANCE);
        const parsed = parseAIAgentPersisted(JSON.stringify({ appearance: { fontSize: 30, unknown: true } }));
        expect(parsed.appearance?.fontSize).toBe(24);
        expect(parsed.appearance).not.toHaveProperty("unknown");
    });

    it("读取并清洗本地字体资源元数据", () => {
        const parsed = parseAIAgentPersisted(JSON.stringify({
            fontResources: [
                { id: "demo", family: " Demo ", fileName: "demo.woff2", weight: 500 },
                { id: "../escape", family: "Bad", fileName: "bad.ttf" },
            ],
        }));
        expect(parsed.fontResources).toHaveLength(1);
        expect(parsed.fontResources?.[0].family).toBe("Demo");
    });

    it("兼容没有版本号的旧配置，并过滤非法字段", () => {
        const parsed = parseAIAgentPersisted(
            JSON.stringify({
                apiBase: "https://api.example.com/",
                token: "token",
                deviceId: "device",
                state: { credits: 120, plan: "pro", syncState: { enabled: true, status: "ok" } },
                tasks: [
                    { taskId: "t-1", message: "ok", status: "done", createdAt: 1 },
                    { taskId: 42, message: "bad", status: "done", createdAt: 2 },
                ],
                showBall: false,
                includeActiveNoteContext: true,
                floatingPosition: { x: 0.25, y: 0.75 },
                unknown: "ignored",
            })
        );

        expect(parsed.version).toBe(PERSISTED_VERSION);
        expect(parsed.apiBase).toBe("https://api.example.com/");
        expect(parsed.token).toBe("token");
        expect(parsed.state).toEqual({ credits: 120, plan: "pro", syncState: { enabled: true, status: "ok" } });
        expect(parsed.tasks).toHaveLength(1);
        expect(parsed.tasks?.[0].taskId).toBe("t-1");
        expect(parsed.showBall).toBe(false);
        expect(parsed.includeActiveNoteContext).toBe(true);
        expect(parsed.floatingPosition).toEqual({ x: 0.25, y: 0.75 });
        expect(parsed).not.toHaveProperty("unknown");
    });

    it("忽略错误类型的凭据和偏好，而不是把它们写回配置", () => {
        const parsed = parseAIAgentPersisted(JSON.stringify({
            apiBase: 42, token: null, deviceId: {}, tripleTap: "yes", includeActiveNoteContext: "yes",
            floatingPosition: { x: -1, y: 2 },
        }));

        expect(parsed.version).toBe(PERSISTED_VERSION);
        expect(parsed).not.toHaveProperty("apiBase");
        expect(parsed).not.toHaveProperty("token");
        expect(parsed.appearance).toBeDefined();
    });
});
