import { beforeEach, describe, expect, it, vi } from "vitest";

const requestUrlMock = vi.fn();
vi.mock("@/deps.ts", () => ({
    requestUrl: (...args: unknown[]) => requestUrlMock(...args),
}));

import { CmdAIAgent, normalizeProNamespaceInfo, readProNamespaceDetail } from "./CmdAIAgent";

const okJson = (data: unknown) => ({ status: 200, json: data });

type EndpointReply = { status: number; data: unknown };

interface RouteReplies {
    getStatus?: EndpointReply;
    postOpen?: EndpointReply;
}

/** Route by path/method so a test never depends on call order. */
function routeMock(replies: RouteReplies) {
    requestUrlMock.mockImplementation(async (req: { url?: unknown; method?: unknown }) => {
        const url = String(req?.url ?? "");
        const method = String(req?.method ?? "GET").toUpperCase();
        if (url.endsWith("/api/pro/namespace")) {
            const reply = method === "POST" ? replies.postOpen : replies.getStatus;
            if (!reply) return { status: 503, json: { detail: "no handler" } };
            return { status: reply.status, json: reply.data };
        }
        if (url.endsWith("/api/sync/handshake")) {
            return {
                status: 200,
                json: { enabled: true, status: "ok", gate: "ready", conflict_state: "none", activation_id: "sync-test" },
            };
        }
        return { status: 404, json: { detail: "unexpected path" } };
    });
}

const PRO_STATUS = {
    enabled: true,
    status: "ready",
    ready: true,
    read_only: false,
    used_mb: 3,
    namespace: "t_aaaa00000000000000000000000000_pro",
};

describe("CmdAIAgent Pro 独立同步空间", () => {
    let agent: CmdAIAgent;
    let applySetupUri: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        requestUrlMock.mockReset();
        agent = new CmdAIAgent();
        agent.deviceId = "test-device";
        agent.configure("https://api.example.com", "device-token");
        applySetupUri = vi.fn().mockResolvedValue(true);
        agent.applySetupUri = applySetupUri as unknown as CmdAIAgent["applySetupUri"];
    });

    it("非 Pro：GET 403 原样回传 detail，并标为不可用", async () => {
        routeMock({ getStatus: { status: 403, data: { detail: "Pro 会员专属权益" } } });

        const result = await agent.proNamespaceStatus();

        expect(result).toEqual({ ok: false, message: "Pro 会员专属权益" });
        expect(agent.proNamespace).toMatchObject({ httpStatus: 403, available: false, message: "Pro 会员专属权益" });
        expect(applySetupUri).not.toHaveBeenCalled();
    });

    it("状态查询是只读的：绝不切换档案", async () => {
        routeMock({ getStatus: { status: 200, data: PRO_STATUS } });

        const result = await agent.proNamespaceStatus();

        expect(result.ok).toBe(true);
        expect(applySetupUri).not.toHaveBeenCalled();
        expect(agent.proNamespace).toMatchObject({
            available: true,
            namespace: PRO_STATUS.namespace,
            ready: true,
            read_only: false,
            used_mb: 3,
        });
        const onlyCall = requestUrlMock.mock.calls[0][0] as { method?: string; url?: string };
        expect(onlyCall.method).toBe("GET");
        expect(String(onlyCall.url)).toContain("/api/pro/namespace");
    });

    it("显式开通：POST 取回 setup URI 后复用 applySetupUri 应用并回读状态", async () => {
        routeMock({
            postOpen: {
                status: 200,
                data: { ...PRO_STATUS, setup_uri: "obsidian://setuplivesync?settings=AAA", setup_passphrase: "setup-key" },
            },
            getStatus: { status: 200, data: PRO_STATUS },
        });

        const result = await agent.requestProNamespace();

        expect(applySetupUri).toHaveBeenCalledTimes(1);
        expect(applySetupUri).toHaveBeenCalledWith("obsidian://setuplivesync?settings=AAA", "setup-key");
        expect(result.ok).toBe(true);
        expect(result.message).toContain(PRO_STATUS.namespace);
        expect(agent.proNamespace).toMatchObject({ available: true, enabled: true, namespace: PRO_STATUS.namespace });
        const postCall = requestUrlMock.mock.calls[0][0] as { method?: string };
        expect(postCall.method).toBe("POST");
    });

    it("写回后回读自检失败时必须报错，绝不静默成功", async () => {
        applySetupUri.mockResolvedValueOnce(false);
        routeMock({
            postOpen: {
                status: 200,
                data: { ...PRO_STATUS, setup_uri: "obsidian://setuplivesync?settings=AAA", setup_passphrase: "setup-key" },
            },
        });

        const result = await agent.requestProNamespace();

        expect(result.ok).toBe(false);
        expect(result.message).toContain("回读自检失败");
        expect(agent.proNamespace?.message ?? "").toContain("回读自检失败");
        // 自检失败后不应再发额外请求（含握手）
        expect(requestUrlMock).toHaveBeenCalledTimes(1);
    });

    it("已知非 Pro（403）后不再发起开通请求", async () => {
        routeMock({ getStatus: { status: 403, data: { detail: "Pro 会员专属权益" } } });
        await agent.proNamespaceStatus();
        requestUrlMock.mockClear();

        const result = await agent.requestProNamespace("card-key");

        expect(result).toEqual({ ok: false, message: "Pro 会员专属权益" });
        expect(requestUrlMock).not.toHaveBeenCalled();
        expect(applySetupUri).not.toHaveBeenCalled();
    });

    it("POST 403 也按非 Pro 处理，原样回传 detail", async () => {
        routeMock({ postOpen: { status: 403, data: { detail: "Pro 会员专属权益" } } });

        const result = await agent.requestProNamespace("card-key");

        expect(result).toEqual({ ok: false, message: "Pro 会员专属权益" });
        expect(agent.proNamespace).toMatchObject({ httpStatus: 403, available: false });
        expect(applySetupUri).not.toHaveBeenCalled();
    });

    it("服务端未给出同步口令时明确失败，不拿空口令硬写档案", async () => {
        routeMock({ postOpen: { status: 200, data: { ...PRO_STATUS, setup_uri: "obsidian://setuplivesync?settings=AAA" } } });

        const result = await agent.requestProNamespace();

        expect(result.ok).toBe(false);
        expect(result.message).toContain("缺少同步口令");
        expect(applySetupUri).not.toHaveBeenCalled();
    });

    it("响应体按未知 JSON 防御式解析", () => {
        expect(normalizeProNamespaceInfo(null)).toEqual({
            enabled: false,
            status: "",
            ready: false,
            read_only: false,
            used_mb: 0,
            namespace: "",
        });
        expect(normalizeProNamespaceInfo({ enabled: "yes", used_mb: "12", namespace: 7, ready: 1 })).toMatchObject({
            enabled: false,
            used_mb: 0,
            namespace: "",
            ready: false,
        });
        expect(normalizeProNamespaceInfo({ ...PRO_STATUS, read_only: true, db_name: "t_fallback_pro", namespace: undefined })).toMatchObject({
            read_only: true,
            namespace: "t_fallback_pro",
        });
        expect(readProNamespaceDetail({ detail: " a\nb " })).toBe("a b");
        expect(readProNamespaceDetail({})).toBeNull();
    });
});
