import { describe, expect, it, vi } from "vitest";
import type { AITask } from "./CmdAIAgent";
import { buildErrorReportPayload, isDiagnosticEligible, uploadErrorReport } from "./diagnosticsUpload";

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
        const request = vi.fn(async () => ({ status: 201, json: async () => ({ request_id: "r-1" }) }));
        const confirm = vi.fn(async () => false);
        const result = await uploadErrorReport("https://api.example", "token", task, {
            pluginVersion: "2.0.5", obsidianVersion: "1.9", platform: "desktop", diagnosticsLog: "safe",
        }, { confirm, request });
        expect(result.ok).toBe(false);
        expect(confirm).toHaveBeenCalledOnce();
        expect(request).not.toHaveBeenCalled();
    });

    it("includes a completed task whose local artifact delivery failed", () => {
        expect(isDiagnosticEligible({ ...task, status: "done", deliveryStatus: "failed" })).toBe(true);
    });
});
