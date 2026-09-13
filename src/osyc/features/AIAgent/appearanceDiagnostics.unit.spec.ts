import { describe, expect, it } from "vitest";
import { buildAppearanceDiagnostics } from "./appearanceDiagnostics";

describe("appearance diagnostics", () => {
    it("returns a small, redacted report without credentials or vault paths", () => {
        const report = buildAppearanceDiagnostics({
            pluginVersion: "1.0.41",
            obsidianVersion: "1.13.1",
            platform: "android",
            viewport: { width: 390, height: 844 },
            theme: "dark",
            appearanceVersion: 1,
            backgroundEnabled: true,
            backgroundType: "image",
            backgroundExists: true,
            safeArea: { top: 24, right: 0, bottom: 34, left: 0 },
            overflow: { taskList: false, composer: false },
            lastErrorCode: 502,
            cardKey: "REAL-FLASH-TEST",
            token: "Bearer secret",
            vaultPath: "秘密/背景.png",
            noteBody: "private note",
        });
        expect(report).toContain("1.0.41");
        expect(report).toContain('"errorCode":502');
        expect(report).not.toContain("REAL-FLASH-TEST");
        expect(report).not.toContain("Bearer secret");
        expect(report).not.toContain("背景.png");
        expect(report).not.toContain("private note");
    });
});
