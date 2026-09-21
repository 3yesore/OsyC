import { describe, expect, it, vi } from "vitest";
import type { AITask } from "./CmdAIAgent";
import { buildErrorReportPayload, isDiagnosticEligible, uploadErrorReport, type ErrorReportRequest } from "./diagnosticsUpload";

describe("OsyC failed-task diagnostics", () => {
    const task: AITask = {
        taskId: "task-1", message: "整理我的笔记", status: "failed", error: "Bearer sk-secret failed",
        responseText: "模型回复不应完整上传", progressEvents: [{ phase: "model_output", message: "secret output", at: 1 }], createdAt: 1,
    };

    it("builds a bounded payload without Vault or credential text", () => {
        const payload = buildErrorReportPayload(task, {
            pluginVersion: "2.0.5", obsidianVersion: "1.9", platform: "android",
            runtimeInfo: { backend_release_id: "r1" }, diagnosticsLog: "Authorization: Bearer sk-secret",
        });
        expect(payload).toMatchObject({ task_id: "task-1", task_status: "failed", plugin_version: "2.0.5" });
        expect(JSON.stringify(payload)).not.toContain("sk-secret");
        expect(JSON.stringify(payload)).not.toContain("模型回复不应完整上传");
        expect(JSON.stringify(payload)).not.toContain("Vault");
    });

    it("requires confirmation before uploading", async () => {
        const request = vi.fn(async () => ({ status: 201, json: async () => ({ report_id: "r-1" }) }));
        const confirm = vi.fn(async () => false);
        const result = await uploadErrorReport("https://api.example", "token", task, {
            pluginVersion: "2.0.5", obsidianVersion: "1.9", platform: "desktop", diagnosticsLog: "safe",
        }, { confirm, request });
        expect(result.ok).toBe(false);
        expect(confirm).toHaveBeenCalledOnce();
        expect(request).not.toHaveBeenCalled();
    });

    it("sends the payload request id as the idempotency key and shows the report number", async () => {
        const request = vi.fn(async (_request: Parameters<ErrorReportRequest>[0]) => ({ status: 201, json: async () => ({ report_id: "report-42" }) }));
        const result = await uploadErrorReport("https://api.example", "token", task, {
            pluginVersion: "2.0.6", obsidianVersion: "1.9", platform: "desktop", diagnosticsLog: "safe",
        }, { confirm: async () => true, request });
        expect(request.mock.calls[0][0].headers?.["Idempotency-Key"]).toBeTruthy();
        expect(result).toMatchObject({ ok: true, requestId: "report-42" });
        expect(result.message).toContain("report-42");
    });

    it("includes a completed task whose local artifact delivery failed", () => {
        expect(isDiagnosticEligible({ ...task, status: "done", deliveryStatus: "failed" })).toBe(true);
    });
});

describe("脱敏诊断载荷 2.0.17", () => {
    const task: AITask = {
        taskId: "task-2", message: "整理我的笔记", status: "failed", error: "服务端 500",
        responseText: "", progressEvents: [], createdAt: 1,
    };

    const fullContext = () => ({
        pluginVersion: "2.0.17",
        obsidianVersion: "1.9",
        platform: "android",
        diagnosticsLog: "line-1\nline-2",
        accountSummary: { plan: "pro", activated: true, login: "email" as const, email_masked: "alice@example.com" },
        livesyncSummary: {
            configuration: "OsyC 同步",
            endpoint: "https://user:pw@sync.example.com:6984/db",
            remote_type: "couchdb",
            protocol_version: 2,
            node_id_short: "abcd1234",
            milestone_accepted: false,
            last_pull_at: 1700000000,
            last_push_at: 1700000100,
            settings_fingerprint: {
                customChunkSize: 0,
                hashAlg: "xxhash64",
                chunkSplitterVersion: "v3",
                remoteType: "couchdb",
            },
            error: null,
        },
        apiFailures: [{ at: "2026-09-21T00:00:00.000Z", path: "/api/send?token=abcd1234", status: 500 }],
    });

    it("carries account tier, LiveSync summary with the settings fingerprint, and API failures", () => {
        const payload = buildErrorReportPayload(task, fullContext());
        expect(payload.account_summary).toMatchObject({ plan: "pro", activated: true, login: "email" });
        expect(payload.account_summary?.email_masked).toBe("a***@e***.com");
        expect(payload.livesync_summary).toMatchObject({
            configuration: "OsyC 同步",
            remote_type: "couchdb",
            protocol_version: 2,
            node_id_short: "abcd1234",
            milestone_accepted: false,
            last_pull_at: 1700000000,
            last_push_at: 1700000100,
        });
        expect(payload.livesync_summary?.settings_fingerprint).toEqual({
            customChunkSize: 0,
            hashAlg: "xxhash64",
            chunkSplitterVersion: "v3",
            remoteType: "couchdb",
        });
        expect(payload.api_failures).toHaveLength(1);
        expect(payload.api_failures[0]).toMatchObject({ path: "/api/send?token=[REDACTED]", status: 500 });
    });

    it("masks card keys, tokens, passphrases, full setup URIs and emails", () => {
        const context = fullContext();
        context.diagnosticsLog = [
            "激活：card_key=CARD-SECRET-9999",
            "Authorization: Bearer sk-live-abcdef123456",
            "passphrase: my-secret-pass",
            "setup=obsidian://setupsync?setup=SUPERSECRETVALUE",
            "联系人 user@real.example.com",
        ].join("\n");
        context.accountSummary.email_masked = "real@person.example.com";
        const payload = buildErrorReportPayload(task, context);
        const json = JSON.stringify(payload);
        expect(json).not.toContain("CARD-SECRET-9999");
        expect(json).not.toContain("sk-live-abcdef123456");
        expect(json).not.toContain("my-secret-pass");
        expect(json).not.toContain("SUPERSECRETVALUE");
        expect(json).not.toContain("obsidian://setupsync");
        expect(json).not.toContain("user@real.example.com");
        expect(json).not.toContain("real@person.example.com");
        // 端点即使被塞进完整连接串，上传的也只有域名（凭据与库名都丢掉）。
        expect(payload.livesync_summary?.endpoint).toBe("https://sync.example.com:6984");
        expect(JSON.stringify(payload)).not.toContain("user:pw@");
    });

    it("keeps up to 8000 characters of diagnostics log instead of truncating at 600", () => {
        const context = fullContext();
        context.diagnosticsLog = "X".repeat(2500);
        const payload = buildErrorReportPayload(task, context);
        expect(payload.diagnostics_log).toHaveLength(2500);
    });

    it("defaults the new sections to empty instead of throwing when the caller omits them", () => {
        const payload = buildErrorReportPayload(task, {
            pluginVersion: "2.0.17", obsidianVersion: "1.9", platform: "desktop", diagnosticsLog: "safe",
        });
        expect(payload.account_summary).toBeNull();
        expect(payload.livesync_summary).toBeNull();
        expect(payload.api_failures).toEqual([]);
    });
});
