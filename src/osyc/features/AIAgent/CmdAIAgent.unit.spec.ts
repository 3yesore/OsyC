import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const requestUrlMock = vi.fn();
vi.mock("@/deps.ts", () => ({
    requestUrl: (...args: unknown[]) => requestUrlMock(...args),
}));

import { get } from "svelte/store";
import { CmdAIAgent, isRuntimeCompatible, isSyncFailed, normaliseApiBase, normaliseExpireAt } from "./CmdAIAgent";

// 插件运行于 Obsidian 渲染进程，window 一定存在；单测跑在 Node 下需要补一个。
beforeAll(() => {
    if (typeof (globalThis as { window?: unknown }).window === "undefined") {
        (globalThis as { window?: unknown }).window = globalThis;
    }
});

const flush = () => new Promise((r) => setTimeout(r, 0));
const flushMicrotasks = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
};

describe("CmdAIAgent", () => {
    let agent: CmdAIAgent;

    beforeEach(() => {
        requestUrlMock.mockReset();
        agent = new CmdAIAgent();
        agent.deviceId = "test-device";
    });

    afterEach(() => {
        // Stop timers started by send()/resumePending() so one test cannot
        // consume another test's mocked polling responses.
        agent.stop();
        vi.useRealTimers();
    });

    it("将历史 /osyc 服务地址归一化到 OsyC API 根路径", () => {
        expect(normaliseApiBase("https://api.sacu3.cn/osyc")).toBe("https://api.sacu3.cn");
        expect(normaliseApiBase("https://api.sacu3.cn/osyc/")).toBe("https://api.sacu3.cn");
        expect(normaliseApiBase("https://api.sacu3.cn/osyc?legacy=1")).toBe("https://api.sacu3.cn");
        expect(normaliseApiBase("https://self-hosted.example/osyc-extra")).toBe("https://self-hosted.example/osyc-extra");
    });

    it("统一兼容后端秒级和毫秒级到期时间戳", () => {
        expect(normaliseExpireAt(1_893_456_000)).toBe(1_893_456_000_000);
        expect(normaliseExpireAt(1_893_456_000_000)).toBe(1_893_456_000_000);
        expect(normaliseExpireAt(null)).toBeNull();
        expect(normaliseExpireAt("1893456000")).toBeNull();
    });

    it("按服务端声明的插件兼容范围校验版本", () => {
        expect(isRuntimeCompatible("2.0.3", ">=2.0.3 <2.1.0")).toBe(true);
        expect(isRuntimeCompatible("2.0.4", ">=2.0.3 <2.1.0")).toBe(true);
        expect(isRuntimeCompatible("1.9.9", ">=2.0.3 <2.1.0")).toBe(false);
        expect(isRuntimeCompatible("2.1.0", ">=2.0.3 <2.1.0")).toBe(false);
        expect(isRuntimeCompatible("dev", ">=2.0.3 <2.1.0")).toBe(false);
    });

    it("已确认服务端不兼容时不发送任务", async () => {
        agent.configure("https://api.example.com", "token");
        agent.runtimeInfo = {
            backend_release_id: "old",
            hermes_adapter_version: "1",
            artifact_intent_policy_version: "1",
            streaming_protocol_version: "1",
            plugin_compatibility: ">=1.0.72 <1.0.73",
        };

        await agent.send("测试");

        const task = get(agent.tasks)[0];
        expect(task.status).toBe("failed");
        expect(task.error).toContain("版本不兼容");
        expect(requestUrlMock).not.toHaveBeenCalled();
    });

    it("未配置服务地址时进入 MOCK 模式", () => {
        expect(agent.isMock).toBe(true);
    });

    it("MOCK 模式下任务会流转到完成并扣减积分", async () => {
        await agent.activate("any-key");
        const creditsBefore = get(agent.state).credits;

        await agent.send("整理本周笔记");
        expect(get(agent.tasks)[0].status).toBe("queued");

        // 让模拟任务跑完
        await new Promise((r) => setTimeout(r, 4600));

        const task = get(agent.tasks)[0];
        expect(task.status).toBe("done");
        expect(task.filesChanged?.length).toBeGreaterThan(0);
        expect(get(agent.state).credits).toBeLessThan(creditsBefore);
    });

    it("服务端返回错误码时映射为中文提示", async () => {
        agent.configure("https://api.example.com", "token");
        requestUrlMock.mockResolvedValue({ status: 402, json: {} });

        await agent.send("整理本周笔记");
        await flush();

        const task = get(agent.tasks)[0];
        expect(task.status).toBe("failed");
        expect(task.error).toBe("积分不足，请充值后再试");
        expect(task.errorCode).toBe(402);
    });

    it("已成功写入后不再显示旧的同步失败标记", () => {
        expect(isSyncFailed({ taskId: "done", message: "x", status: "done", progress: "同步回传失败", deliveryStatus: "failed", createdAt: 1 })).toBe(true);
        expect(isSyncFailed({ taskId: "done", message: "x", status: "done", progress: "同步回传失败", deliveryStatus: "delivered", createdAt: 1 })).toBe(false);
    });

    it("发送入口保留服务端错误原因，便于定位最小任务失败", async () => {
        agent.configure("https://api.example.com", "token");
        requestUrlMock.mockResolvedValue({ status: 502, json: { detail: "上游模型返回空响应" } });

        await agent.send("测试");

        const task = get(agent.tasks)[0];
        expect(task.status).toBe("failed");
        expect(task.error).toContain("上游模型返回空响应");
        expect(task.errorCode).toBe(502);
    });

    it("真实发送可选携带当前笔记快照，且旧调用仍只发送指令", async () => {
        agent.configure("https://api.example.com", "token");
        requestUrlMock.mockResolvedValue({ status: 200, json: { task_id: "note-context", est_cost: 10 } });
        const snapshot = {
            path: "项目/方案.md", mode: "edit" as const, content: "未保存正文", sha256: "a".repeat(64),
            capturedAt: "2026-09-02T00:00:00.000Z", cursor: { line: 1, ch: 2 },
        };

        await agent.send("检查当前段落", snapshot);
        expect(JSON.parse(requestUrlMock.mock.calls[0][0].body)).toEqual({ message: "检查当前段落", active_note: snapshot });
        agent.stop();
    });

    it("网络异常时给出稳定且可行动的提示", async () => {
        agent.configure("https://api.example.com", "token");
        requestUrlMock.mockRejectedValueOnce(new Error("socket closed"));

        await agent.send("整理本周笔记");

        const task = get(agent.tasks)[0];
        expect(task.status).toBe("failed");
        expect(task.error).toBe("网络连接失败，请检查网络后重试");
    });

    it("并发发送时只将请求失败标记到对应的临时任务", async () => {
        agent.configure("https://api.example.com", "token");
        requestUrlMock.mockImplementation(async (request: { body?: string }) => {
            const body = JSON.parse(request.body ?? "{}") as { message?: string };
            if (body.message === "第一条") return { status: 200, json: { task_id: "server-first", est_cost: 10 } };
            throw new Error("second request failed");
        });

        await Promise.all([agent.send("第一条"), agent.send("第二条")]);
        const tasks = get(agent.tasks);
        expect(tasks.find((item) => item.message === "第一条")?.status).toBe("queued");
        expect(tasks.find((item) => item.message === "第二条")?.status).toBe("failed");
    });

    it("轮询遇到临时服务端错误时重试，而不是立刻失败", async () => {
        vi.useFakeTimers();
        try {
            agent.configure("https://api.example.com", "token");
            requestUrlMock
                .mockResolvedValueOnce({ status: 200, json: { task_id: "retry-task", est_cost: 10 } })
                .mockResolvedValueOnce({ status: 503, json: {} })
                .mockResolvedValueOnce({ status: 200, json: { status: "done", progress: "完成" } });

            await agent.send("临时故障后继续");
            await vi.advanceTimersByTimeAsync(3000);
            expect(get(agent.tasks)[0].status).not.toBe("failed");

            await vi.advanceTimersByTimeAsync(3000);
            expect(get(agent.tasks)[0].status).toBe("done");
        } finally {
            vi.useRealTimers();
        }
    });

    it("部分轮询响应不会清空已收到的任务字段", async () => {
        vi.useFakeTimers();
        try {
            agent.configure("https://api.example.com", "token");
            requestUrlMock
                .mockResolvedValueOnce({ status: 200, json: { task_id: "partial-task", est_cost: 10 } })
                .mockResolvedValueOnce({
                    status: 200,
                    json: {
                        status: "running",
                        progress: "已读取笔记",
                        files_changed: ["结果.md"],
                        actual_cost: 7,
                        model_quota_cost: 2,
                        settings_patch: { language: "zh" },
                        theme_snippet: { name: "compact", css: ".x{}", reason: "测试" },
                        response_text: "第一段",
                    },
                })
                .mockResolvedValueOnce({ status: 200, json: { status: "running", response_text: "第一段\n第二段" } });

            await agent.send("检查");
            await vi.advanceTimersByTimeAsync(1000);
            await vi.advanceTimersByTimeAsync(1000);
            const current = get(agent.tasks)[0];
            expect(current).toMatchObject({
                progress: "已读取笔记",
                filesChanged: ["结果.md"],
                actualCost: 7,
                modelQuotaCost: 2,
                settingsPatch: { language: "zh" },
                themeSnippet: { name: "compact" },
                responseText: "第一段\n第二段",
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it("待确认任务可以确认一次且不重新发送模型请求", async () => {
        vi.useFakeTimers();
        try {
            agent.configure("https://api.example.com", "token");
            requestUrlMock
                .mockResolvedValueOnce({ status: 200, json: { task_id: "confirm-task", est_cost: 10 } })
                .mockResolvedValueOnce({
                    status: 200,
                    json: {
                        status: "awaiting_confirmation",
                        confirmation: {
                            token: "x".repeat(32), action: "write_note", payload: { path: "a.md" },
                            summary_sha256: "a".repeat(64), expires_at: Date.now() + 600000,
                        },
                    },
                })
                .mockResolvedValueOnce({ status: 200, json: { ok: true, status: "done", result: { message: "已写入" } } });
            await agent.send("写入笔记");
            await vi.advanceTimersByTimeAsync(1000);
            expect(get(agent.tasks)[0].status).toBe("awaiting_confirmation");
            const result = await agent.confirmTask("confirm-task");
            expect(result.ok).toBe(true);
            expect(get(agent.tasks)[0].status).toBe("done");
            expect(requestUrlMock).toHaveBeenCalledTimes(3);
            expect(String(requestUrlMock.mock.calls[2][0].url)).toContain("/confirm");
            expect(JSON.parse(requestUrlMock.mock.calls[2][0].body)).toEqual({ token: "x".repeat(32), summary_sha256: "a".repeat(64) });
        } finally {
            vi.useRealTimers();
        }
    });

    it("取消待确认任务只更新本地状态，不重复调用模型", async () => {
        agent.configure("https://api.example.com", "token");
        requestUrlMock
            .mockResolvedValueOnce({ status: 200, json: { task_id: "cancel-confirm", est_cost: 10 } })
            .mockResolvedValueOnce({ status: 200, json: { status: "awaiting_confirmation", confirmation: { token: "y".repeat(32), action: "delete_note", payload: { path: "a.md" }, summary_sha256: "b".repeat(64), expires_at: Date.now() + 600000 } } })
            .mockResolvedValueOnce({ status: 200, json: { ok: true, status: "cancelled" } });
        await agent.send("删除笔记");
        await new Promise((resolve) => setTimeout(resolve, 1100));
        expect(get(agent.tasks)[0].status).toBe("awaiting_confirmation");
        const result = await agent.cancelConfirmation("cancel-confirm");
        expect(result.ok).toBe(true);
        expect(get(agent.tasks)[0].status).toBe("cancelled");
        expect(requestUrlMock).toHaveBeenCalledTimes(3);
        expect(String(requestUrlMock.mock.calls[2][0].url)).toContain("/cancel-confirmation");
    });

    it("完成任务必须下载、校验并写入 artifact 后才标记交付成功", async () => {
        vi.useFakeTimers();
        try {
            agent.configure("https://api.example.com", "token");
            const bytes = new TextEncoder().encode("hello");
            const artifact = {
                path: "整理/结果.md",
                size: bytes.byteLength,
                sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
            };
            agent.artifactWriter = vi.fn().mockResolvedValue({ ok: true });
            (agent as unknown as { sha256: (value: Uint8Array) => Promise<string> }).sha256 = vi.fn().mockResolvedValue(artifact.sha256);
            requestUrlMock
                .mockResolvedValueOnce({ status: 200, json: { task_id: "artifact-task", est_cost: 10 } })
                .mockResolvedValueOnce({
                    status: 200,
                    json: {
                        status: "done",
                        progress: "完成",
                        artifacts: [artifact],
                        sync_state: {
                            enabled: true,
                            status: "degraded",
                            vault_name: "Learning-Vault",
                            last_pull_at: 1788400000,
                            last_push_at: 1788400100,
                            staleness_seconds: 12,
                            last_error_code: "sync_push_failed",
                            last_error_hint: "上次上行超时",
                            conflict_state: "pending",
                        },
                    },
                })
                .mockResolvedValueOnce({ status: 200, arrayBuffer: bytes.buffer, headers: { "content-length": "5", "x-osyc-artifact-sha256": artifact.sha256 } })
                .mockResolvedValueOnce({ status: 200, json: { ok: true } });

            await agent.send("生成结果");
            await vi.advanceTimersByTimeAsync(0);
            await vi.advanceTimersByTimeAsync(3000);
            await flushMicrotasks();

            expect(agent.artifactWriter).toHaveBeenCalledOnce();
            expect(get(agent.tasks)[0].deliveryStatus).toBe("delivered");
            expect(get(agent.tasks)[0].responseText).toBe("hello");
            expect(get(agent.tasks)[0].syncState?.vault_name).toBe("Learning-Vault");
            expect(get(agent.state).syncState.status).toBe("degraded");
            expect(requestUrlMock.mock.calls[3][0].url).toContain("artifact-ack");
        } finally {
            agent.stop();
            vi.useRealTimers();
        }
    });

    it("artifact 哈希不一致时不写入、不确认，任务保留失败交付状态", async () => {
        vi.useFakeTimers();
        try {
            agent.configure("https://api.example.com", "token");
            const artifact = { path: "整理/结果.md", size: 5, sha256: "a".repeat(64) };
            agent.artifactWriter = vi.fn().mockResolvedValue({ ok: true });
            (agent as unknown as { sha256: (value: Uint8Array) => Promise<string> }).sha256 = vi.fn().mockResolvedValue("b".repeat(64));
            requestUrlMock
                .mockResolvedValueOnce({ status: 200, json: { task_id: "bad-hash", est_cost: 10 } })
                .mockResolvedValueOnce({ status: 200, json: { status: "done", artifacts: [artifact] } })
                .mockResolvedValueOnce({ status: 200, arrayBuffer: new TextEncoder().encode("hello").buffer, headers: { "content-length": "5", "x-osyc-artifact-sha256": artifact.sha256 } });

            await agent.send("校验错误");
            await vi.advanceTimersByTimeAsync(3000);
            await flushMicrotasks();

            expect(agent.artifactWriter).not.toHaveBeenCalled();
            expect(get(agent.tasks)[0].deliveryStatus).toBe("failed");
            expect(requestUrlMock.mock.calls.some(([req]) => String(req.url).includes("artifact-ack"))).toBe(false);
        } finally {
            agent.stop();
            vi.useRealTimers();
        }
    });

    it("本地 artifact 冲突时不覆盖用户内容，也不确认服务器结果", async () => {
        agent.configure("https://api.example.com", "token");
        const bytes = new TextEncoder().encode("hello");
        const artifact = {
            path: "整理/结果.md",
            size: bytes.byteLength,
            sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        };
        agent.artifactWriter = vi.fn().mockResolvedValue({ ok: false, conflict: true, message: "本地文件冲突" });
        (agent as unknown as { sha256: (value: Uint8Array) => Promise<string> }).sha256 = vi.fn().mockResolvedValue(artifact.sha256);
        requestUrlMock
            .mockResolvedValueOnce({ status: 200, arrayBuffer: bytes.buffer, headers: { "content-length": "5", "x-osyc-artifact-sha256": artifact.sha256 } });
        agent.restore({}, [{ taskId: "conflict-task", message: "冲突", status: "done", createdAt: Date.now(), artifacts: [artifact], deliveryStatus: "pending" }]);

        const result = await agent.retryPush("conflict-task");
        expect(result).toEqual({ ok: false, message: "本地文件冲突" });
        expect(agent.artifactWriter).toHaveBeenCalledOnce();
        expect(requestUrlMock).toHaveBeenCalledTimes(1);
        expect(get(agent.tasks)[0].deliveryStatus).toBe("conflict");
    });

    it("artifact 重试只重新下载并确认，不重新调用模型", async () => {
        agent.configure("https://api.example.com", "token");
        const bytes = new TextEncoder().encode("hello");
        const artifact = {
            path: "整理/结果.md",
            size: bytes.byteLength,
            sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        };
        agent.artifactWriter = vi.fn().mockResolvedValue({ ok: true });
        (agent as unknown as { sha256: (value: Uint8Array) => Promise<string> }).sha256 = vi.fn().mockResolvedValue(artifact.sha256);
        requestUrlMock
            .mockResolvedValueOnce({ status: 200, arrayBuffer: bytes.buffer, headers: { "content-length": "5", "x-osyc-artifact-sha256": artifact.sha256 } })
            .mockResolvedValueOnce({ status: 200, json: { ok: true } });
        agent.restore({}, [{ taskId: "retry-artifact", message: "重试", status: "done", createdAt: Date.now(), artifacts: [artifact], deliveryStatus: "failed" }]);

        const result = await agent.retryPush("retry-artifact");
        expect(result.ok).toBe(true);
        expect(agent.artifactWriter).toHaveBeenCalledOnce();
        expect(requestUrlMock).toHaveBeenCalledTimes(2);
        expect(requestUrlMock.mock.calls[0][0].url).toContain("/artifact?");
        expect(requestUrlMock.mock.calls[1][0].url).toContain("artifact-ack");
    });

    it("注销后停止未完成任务的后台轮询", async () => {
        vi.useFakeTimers();
        try {
            agent.configure("https://api.example.com", "token");
            requestUrlMock.mockResolvedValueOnce({ status: 200, json: { task_id: "cancel-task", est_cost: 10 } });

            await agent.send("注销时仍在运行");
            agent.deactivate();
            await vi.advanceTimersByTimeAsync(6000);

            expect(requestUrlMock).toHaveBeenCalledTimes(1);
            expect(get(agent.tasks)).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });

    it("激活成功后写入 token 与积分", async () => {
        agent.configure("https://api.example.com", "");
        requestUrlMock.mockResolvedValue({
            status: 200,
            json: { token: "issued-token", credits: 2330, expire_at: 1893456000000, model: "DeepSeek-V4-Pro" },
        });

        const result = await agent.activate("card-key");
        expect(result.ok).toBe(true);
        expect(agent.settings.token).toBe("issued-token");
        expect(get(agent.state).credits).toBe(2330);
    });

    it("激活完成同步配置后触发一次同步握手并保存门禁状态", async () => {
        agent.configure("https://api.example.com", "");
        requestUrlMock.mockImplementation(async (request: { url: string; body?: string }) => {
            if (request.url.endsWith("/api/activate")) {
                return { status: 200, json: { token: "issued-token", credits: 100, expire_at: 1893456000000, setup_uri: "encrypted-setup" } };
            }
            if (request.url.endsWith("/api/sync/handshake")) {
                return { status: 200, json: { enabled: true, status: "ok", gate: "ready", activation_id: "sync-fresh", markdown_files: 31, total_files: 31 } };
            }
            if (request.url.endsWith("/api/status")) return { status: 200, json: { credits: 100 } };
            return { status: 404, json: {} };
        });
        agent.applySetupUri = vi.fn().mockResolvedValue(true);

        const result = await agent.activate("card-key");
        expect(result.ok).toBe(true);
        const handshake = requestUrlMock.mock.calls.find(([request]) => String((request as { url: string }).url).endsWith("/api/sync/handshake"));
        expect(handshake).toBeTruthy();
        expect(JSON.parse((handshake?.[0] as { body: string }).body).activation_id).toMatch(/^sync-/);
        expect(get(agent.state).syncState.status).toBe("ok");
        expect(get(agent.state).syncState.markdown_files).toBe(31);
    });

    it("重新同步使用新的握手 ID，不调用模型也不改变积分", async () => {
        agent.configure("https://api.example.com", "token");
        agent.restore({ activated: true, credits: 900 }, []);
        requestUrlMock.mockResolvedValue({
            status: 200,
            json: { enabled: true, status: "ok", gate: "ready", activation_id: "fresh", markdown_files: 31, total_files: 31 },
        });

        const result = await agent.refreshSync();
        expect(result.ok).toBe(true);
        expect(get(agent.state).credits).toBe(900);
        expect(requestUrlMock).toHaveBeenCalledOnce();
        const body = JSON.parse((requestUrlMock.mock.calls[0][0] as { body: string }).body);
        expect(body.activation_id).toMatch(/^sync-/);
    });

    it("旧服务地址没有握手接口时返回可操作提示", async () => {
        agent.configure("https://old.example.com", "token");
        agent.restore({ activated: true, credits: 900 }, []);
        requestUrlMock.mockResolvedValue({ status: 404, json: { detail: "Not Found" } });

        const result = await agent.refreshSync();
        expect(result.ok).toBe(false);
        expect(result.message).toContain("未部署同步握手");
        expect(get(agent.state).credits).toBe(900);
    });

    it("清空已完成只保留进行中的任务", async () => {
        await agent.activate("k");
        await agent.send("任务一");
        await new Promise((r) => setTimeout(r, 4600));
        agent.configure("https://api.example.com", "token");
        requestUrlMock.mockResolvedValue({ status: 200, json: { task_id: "t-1" } });
        await agent.send("任务二");
        await flush();

        expect(get(agent.tasks).length).toBe(2);
        agent.clearFinished();
        const remaining = get(agent.tasks);
        expect(remaining.length).toBe(1);
        expect(remaining[0].message).toBe("任务二");
    });

    it("注销后回到未激活状态", async () => {
        await agent.activate("k");
        await agent.send("任务");
        agent.deactivate();

        expect(get(agent.state).activated).toBe(false);
        expect(get(agent.state).credits).toBe(0);
        expect(get(agent.tasks).length).toBe(0);
        expect(agent.settings.token).toBe("");
    });

    it("激活后消费后端下发的 plan / entitlements / model_quota / credits_yuan", async () => {
        agent.configure("https://api.example.com", "");
        requestUrlMock.mockResolvedValue({
            status: 200,
            json: {
                token: "issued-token",
                credits: 2330,
                credits_yuan: 5.49,
                model_quota: 11.33,
                expire_at: 1893456000000,
                model: "DeepSeek-V4-Pro",
                plan: "member",
                entitlements: {
                    sync: true,
                    ai_tasks: true,
                    schedules: true,
                    cloud_vault: true,
                    cloud_quota_mb: 100,
                    max_devices: 5,
                    skills: ["layout-polish", "graph-ai"],
                    model_quota: 11.33,
                },
            },
        });

        const result = await agent.activate("card-key");
        expect(result.ok).toBe(true);
        const state = get(agent.state);
        expect(state.plan).toBe("member");
        expect(state.creditsYuan).toBe(5.49);
        expect(state.modelQuota).toBeCloseTo(11.33, 2);
        expect(state.entitlements).not.toBeNull();
        expect(state.entitlements?.maxDevices).toBe(5);
        expect(state.entitlements?.schedules).toBe(true);
        expect(state.entitlements?.cloudVault).toBe(true);
        expect(state.entitlements?.cloudQuotaMb).toBe(100);
        expect(state.entitlements?.modelQuota).toBeCloseTo(11.33, 2);
        expect(state.entitlements?.skills).toEqual(["layout-polish", "graph-ai"]);
    });

    it("激活对缺失权益字段有默认值，不崩溃", async () => {
        agent.configure("https://api.example.com", "");
        requestUrlMock.mockResolvedValue({
            status: 200,
            json: { token: "t", credits: 100, plan: "base" },
        });

        const result = await agent.activate("card-key");
        expect(result.ok).toBe(true);
        const state = get(agent.state);
        expect(state.plan).toBe("base");
        expect(state.creditsYuan).toBe(0);
        // 后端没给 entitlements 时，归一化为 null 而非报错
        expect(state.entitlements).toBeNull();
    });

    it("refreshStatus 读取后端下发的 credits_yuan", async () => {
        agent.configure("https://api.example.com", "token");
        requestUrlMock.mockResolvedValue({
            status: 200,
            json: {
                credits: 100,
                credits_yuan: 2.5,
                model_quota: 7.25,
                expire_at: 1893456000,
                model: "DeepSeek-V4-Flash",
                sync_state: {
                    enabled: true,
                    status: "ok",
                    vault_name: "Learning-Vault",
                    last_pull_at: 1788400000,
                    last_push_at: 1788400100,
                    staleness_seconds: 3,
                    last_error_code: null,
                    last_error_hint: null,
                    conflict_state: "none",
                },
            },
        });

        await agent.refreshStatus();
        expect(get(agent.state).credits).toBe(100);
        expect(get(agent.state).creditsYuan).toBe(2.5);
        expect(get(agent.state).modelQuota).toBe(7.25);
        expect(get(agent.state).expireAt).toBe(1893456000000);
        expect(get(agent.state).syncState).toMatchObject({
            enabled: true,
            status: "ok",
            vault_name: "Learning-Vault",
            conflict_state: "none",
        });
    });

    it("does not replace a fresh successful handshake with an older degraded status snapshot", async () => {
        agent.configure("https://api.example.com", "token");
        agent.state.update((state) => ({
            ...state,
            syncState: {
                ...state.syncState,
                enabled: true,
                status: "ok",
                gate: "ready",
                activation_id: "sync-new",
                checked_at: 1788400200,
            },
        }));
        requestUrlMock.mockResolvedValue({
            status: 200,
            json: {
                credits: 100,
                sync_state: {
                    enabled: true,
                    status: "degraded",
                    gate: "degraded",
                    activation_id: "sync-old",
                    checked_at: 1788400100,
                    last_error_code: "stale",
                },
            },
        });

        await agent.refreshStatus();
        expect(get(agent.state).syncState).toMatchObject({ status: "ok", gate: "ready", activation_id: "sync-new" });
    });

    it("restore 会恢复同步快照", () => {
        agent.restore(
            {
                syncState: {
                    enabled: true,
                    status: "failed",
                    vault_name: "Learning-Vault",
                    last_pull_at: 1788400000,
                    last_push_at: null,
                    staleness_seconds: 99,
                    last_error_code: "timeout",
                    last_error_hint: "同步命令超时",
                    conflict_state: "needs_user_action",
                    gate: "blocked",
                    activation_id: null,
                },
            },
            []
        );

        expect(get(agent.state).syncState).toMatchObject({
            enabled: true,
            status: "failed",
            vault_name: "Learning-Vault",
            last_error_code: "timeout",
            conflict_state: "needs_user_action",
        });
    });

    it("MOCK 模式 loadCloudVault 合成两条快照且可用", async () => {
        await agent.activate("k"); // MOCK：token 设好，isMock 仍为真
        expect(agent.isMock).toBe(true);

        await agent.loadCloudVault();
        const cv = get(agent.state).cloudVault;
        expect(cv.available).toBe(true);
        expect(cv.snapshots.length).toBe(2);
        expect(cv.snapshots[0].note_count).toBeGreaterThan(0);
    });

    it("MOCK 模式 cloudBackup 追加快照、cloudRestore 返回成功", async () => {
        await agent.activate("k");
        await agent.loadCloudVault();
        const before = get(agent.state).cloudVault.snapshots.length;

        const backup = await agent.cloudBackup();
        expect(backup.ok).toBe(true);
        expect(get(agent.state).cloudVault.snapshots.length).toBe(before + 1);

        const restore = await agent.cloudRestore("mock-1", false);
        expect(restore.ok).toBe(true);
    });

    it("基础档 loadCloudVault 直接置为不可用（不发起网络请求）", async () => {
        agent.configure("https://api.example.com", "token");
        // 默认 plan 为 base
        await agent.loadCloudVault();
        const cv = get(agent.state).cloudVault;
        expect(cv.available).toBe(false);
        expect(cv.reason).toBe("基础档不可用");
        expect(cv.snapshots.length).toBe(0);
        // 不应触发任何请求
        expect(requestUrlMock).not.toHaveBeenCalled();
    });

    it("Pro 档拉取快照列表成功并标记可用", async () => {
        agent.configure("https://api.example.com", "token");
        agent.state.set({ ...get(agent.state), plan: "pro" });
        requestUrlMock.mockResolvedValue({
            status: 200,
            json: {
                // 后端 list_snapshots 已按 created_at 倒序返回（较新的 s2 在前），
                // 插件不重新排序，直接信任该顺序（排序逻辑由后端测试覆盖）。
                snapshots: [
                    { snapshot_id: "s2", created_at: 1700003600, note_count: 3 },
                    { snapshot_id: "s1", created_at: 1700000000, note_count: 7 },
                ],
            },
        });

        await agent.loadCloudVault();
        const cv = get(agent.state).cloudVault;
        expect(cv.available).toBe(true);
        expect(cv.snapshots.length).toBe(2);
        expect(cv.snapshots[0].snapshot_id).toBe("s2");
    });

    it("Pro 档服务端未启用 Cloud-Vault(R2 未配 503) 时提示未启用", async () => {
        agent.configure("https://api.example.com", "token");
        agent.state.set({ ...get(agent.state), plan: "pro" });
        requestUrlMock.mockResolvedValue({ status: 503, json: {} });

        await agent.loadCloudVault();
        const cv = get(agent.state).cloudVault;
        expect(cv.available).toBe(false);
        expect(cv.reason).toBe("服务端未启用 Cloud-Vault");
    });

    it("会员收到 Cloud-Vault 权限错误时提示基础档不可用", async () => {
        agent.configure("https://api.example.com", "token");
        agent.state.set({ ...get(agent.state), plan: "member" });
        requestUrlMock.mockResolvedValue({ status: 403, json: {} });

        const result = await agent.cloudBackup();
        expect(result.ok).toBe(false);
        expect(result.message).toBe("基础档不可用");
        expect(get(agent.state).cloudVault.reason).toBe("基础档不可用");
    });

    it("MOCK 模式 loadDevices 合成两台设备且标记本机", async () => {
        await agent.activate("k");
        await agent.loadDevices();
        const dv = get(agent.state).devices;
        expect(dv.devices.length).toBe(2);
        expect(dv.max_devices).toBe(3);
        const cur = dv.devices.find((x) => x.is_current);
        expect(cur?.device_id).toBe("test-device");
    });

    it("MOCK 模式 revokeDevice 移除非当前设备、保留本机", async () => {
        await agent.activate("k");
        await agent.loadDevices();
        const before = get(agent.state).devices.devices.length;
        const res = await agent.revokeDevice("mock-phone");
        expect(res.ok).toBe(true);
        const after = get(agent.state).devices.devices;
        expect(after.length).toBe(before - 1);
        expect(after.every((x) => x.device_id !== "mock-phone")).toBe(true);
        expect(after.some((x) => x.is_current)).toBe(true);
    });

    it("MOCK 模式 saveByoKey 标记本机 has_byo_key，clearByoKey 取消", async () => {
        await agent.activate("k");
        await agent.loadDevices();
        const save = await agent.saveByoKey("sk-abc");
        expect(save.ok).toBe(true);
        expect(get(agent.state).devices.devices.find((x) => x.is_current)?.has_byo_key).toBe(true);
        const clear = await agent.clearByoKey();
        expect(clear.ok).toBe(true);
        expect(get(agent.state).devices.devices.find((x) => x.is_current)?.has_byo_key).toBe(false);
    });

    it("真实模式 loadDevices 映射后端下发列表", async () => {
        agent.configure("https://api.example.com", "token");
        requestUrlMock.mockResolvedValue({
            status: 200,
            json: {
                devices: [
                    { device_id: "d-a", activated_at: 1700000000, last_seen_at: 1700003600, is_current: true, has_byo_key: false },
                    { device_id: "d-b", activated_at: 1699990000, last_seen_at: 1700001000, is_current: false, has_byo_key: true },
                ],
                max_devices: 5,
            },
        });
        await agent.loadDevices();
        const dv = get(agent.state).devices;
        expect(dv.devices.length).toBe(2);
        expect(dv.max_devices).toBe(5);
        expect(dv.devices[0].device_id).toBe("d-a");
        expect(dv.devices[1].has_byo_key).toBe(true);
    });

    describe("applyThemeSnippet 客户端实现", () => {
        const snippet = { name: "osyc-calm", css: "body{color:#333}", reason: "更护眼" };

        it("未注入时为空，由桥接层兜底为失败（不静默吞掉）", async () => {
            expect(agent.applyThemeSnippet).toBeUndefined();
            const res =
                (await agent.applyThemeSnippet?.(snippet)) ??
                { ok: false, message: "当前不可应用主题片段" };
            expect(res.ok).toBe(false);
        });

        it("注入后原样透传片段，不做二次改写", async () => {
            const seen: unknown[] = [];
            agent.applyThemeSnippet = async (s) => {
                seen.push(s);
                return { ok: true, message: `已应用主题片段：${s.name}` };
            };
            const res = await agent.applyThemeSnippet!(snippet);
            expect(res.ok).toBe(true);
            expect(res.message).toContain("osyc-calm");
            expect(seen[0]).toEqual(snippet);
        });
    });
});
