import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    platform: {
        isMobile: false,
    },
}));

vi.mock("@/deps.ts", () => ({
    Platform: mocks.platform,
    requestUrl: vi.fn(),
}));

vi.mock("@/deps", () => ({
    Platform: mocks.platform,
    requestUrl: vi.fn(),
}));

vi.mock("@/modules/essentialObsidian/APILib/ObsHttpHandler", () => ({
    ObsHttpHandler: class {},
}));

vi.mock("./ObsidianConfirm", () => ({
    ObsidianConfirm: class {},
}));

import { ObsidianAPIService } from "./ObsidianAPIService";
import type { ObsidianServiceContext } from "./ObsidianServiceContext";

function createService(workspace: Record<string, unknown>, isMobile = false): ObsidianAPIService {
    return new ObsidianAPIService({
        app: { workspace, isMobile },
    } as unknown as ObsidianServiceContext);
}

beforeEach(() => {
    mocks.platform.isMobile = false;
    vi.clearAllMocks();
});

describe("ObsidianAPIService.showWindowOnRight", () => {
    it("keeps the status view in the right leaf on mobile", async () => {
        mocks.platform.isMobile = true;
        const rightLeaf = {
            setViewState: vi.fn().mockResolvedValue(undefined),
        };
        const workspace = {
            getLeavesOfType: vi.fn(() => []),
            getLeaf: vi.fn(),
            getRightLeaf: vi.fn(() => rightLeaf),
            revealLeaf: vi.fn().mockResolvedValue(undefined),
        };
        const service = createService(workspace, true);

        expect(service.isMobile()).toBe(true);
        await service.showWindowOnRight("p2p-status");

        expect(workspace.getLeavesOfType).toHaveBeenCalledWith("p2p-status");
        expect(workspace.getRightLeaf).toHaveBeenCalledWith(false);
        expect(workspace.getLeaf).not.toHaveBeenCalled();
        expect(rightLeaf.setViewState).toHaveBeenCalledWith({
            type: "p2p-status",
            active: false,
        });
        expect(workspace.revealLeaf).toHaveBeenCalledWith(rightLeaf);
    });
});

describe("ObsidianAPIService.showWindow", () => {
    it("opens a new view in a visible main-workspace tab", async () => {
        const leaf = { setViewState: vi.fn().mockResolvedValue(undefined) };
        const workspace = {
            getLeavesOfType: vi.fn(() => []),
            getLeaf: vi.fn(() => leaf),
            revealLeaf: vi.fn().mockResolvedValue(undefined),
        };
        const service = createService(workspace);

        await service.showWindow("livesync-ai-agent");

        expect(workspace.getLeaf).toHaveBeenCalledWith("tab");
        expect(leaf.setViewState).toHaveBeenCalledWith({
            type: "livesync-ai-agent",
            active: true,
        });
        expect(workspace.revealLeaf).toHaveBeenCalledWith(leaf);
    });

    it("reuses and reveals an existing Agent view", async () => {
        const leaf = { setViewState: vi.fn().mockResolvedValue(undefined) };
        const workspace = {
            getLeavesOfType: vi.fn(() => [leaf]),
            getLeaf: vi.fn(),
            revealLeaf: vi.fn().mockResolvedValue(undefined),
        };
        const service = createService(workspace);

        await service.showWindow("livesync-ai-agent");

        expect(workspace.getLeaf).not.toHaveBeenCalled();
        expect(leaf.setViewState).toHaveBeenCalledWith({
            type: "livesync-ai-agent",
            active: true,
        });
        expect(workspace.revealLeaf).toHaveBeenCalledWith(leaf);
    });

    it("serialises concurrent opens so one tap cannot create duplicate leaves", async () => {
        let resolveState: (() => void) | undefined;
        const leaf = {
            setViewState: vi.fn(
                () =>
                    new Promise<void>((resolve) => {
                        resolveState = resolve;
                    })
            ),
        };
        const workspace = {
            getLeavesOfType: vi.fn(() => []),
            getLeaf: vi.fn(() => leaf),
            revealLeaf: vi.fn().mockResolvedValue(undefined),
        };
        const service = createService(workspace);

        const first = service.showWindow("livesync-ai-agent");
        const second = service.showWindow("livesync-ai-agent");
        await Promise.resolve();
        expect(workspace.getLeaf).toHaveBeenCalledTimes(1);

        resolveState?.();
        await Promise.all([first, second]);
        expect(leaf.setViewState).toHaveBeenCalledTimes(1);
        expect(workspace.revealLeaf).toHaveBeenCalledTimes(1);
    });

    it("allows a later open to retry after a failed view activation", async () => {
        const leaf = { setViewState: vi.fn() };
        leaf.setViewState
            .mockRejectedValueOnce(new Error("transient view failure"))
            .mockResolvedValueOnce(undefined);
        const workspace = {
            getLeavesOfType: vi.fn(() => []),
            getLeaf: vi.fn(() => leaf),
            revealLeaf: vi.fn().mockResolvedValue(undefined),
        };
        const service = createService(workspace);

        await expect(service.showWindow("livesync-ai-agent")).rejects.toThrow("transient view failure");
        await service.showWindow("livesync-ai-agent");

        expect(workspace.getLeaf).toHaveBeenCalledTimes(2);
        expect(leaf.setViewState).toHaveBeenCalledTimes(2);
        expect(workspace.revealLeaf).toHaveBeenCalledTimes(1);
    });

    it("moves a legacy sidebar Agent leaf into a main-workspace tab", async () => {
        const legacyLeaf = {
            getViewState: vi.fn(() => ({ type: "livesync-ai-agent" })),
            detach: vi.fn(),
        };
        const mainLeaf = { setViewState: vi.fn().mockResolvedValue(undefined) };
        const workspace = {
            getLeavesOfType: vi.fn(() => [legacyLeaf]),
            iterateRootLeaves: vi.fn(),
            getLeaf: vi.fn(() => mainLeaf),
            revealLeaf: vi.fn().mockResolvedValue(undefined),
        };
        const service = createService(workspace);

        await service.showWindow("livesync-ai-agent");

        expect(workspace.iterateRootLeaves).toHaveBeenCalled();
        expect(workspace.getLeaf).toHaveBeenCalledWith("tab");
        expect(mainLeaf.setViewState).toHaveBeenCalledWith({
            type: "livesync-ai-agent",
            active: true,
        });
        expect(legacyLeaf.detach).toHaveBeenCalledTimes(1);
        expect(workspace.revealLeaf).toHaveBeenCalledWith(mainLeaf);
    });
});
