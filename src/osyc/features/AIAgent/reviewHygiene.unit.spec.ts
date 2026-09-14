import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (name: string): string =>
    readFileSync(resolve(import.meta.dirname, name), "utf8");

describe("Obsidian review hygiene", () => {
    it("uses the active window crypto API for note hashing", () => {
        const source = readSource("activeNoteContext.ts");
        expect(source).not.toContain("globalThis");
        expect(source).toContain("window.crypto");
    });

    it("uses Obsidian DOM helpers in the account modal", () => {
        const source = readSource("AIAgentAccountModal.ts");
        expect(source).not.toMatch(/createEl\(\"div\"/);
        expect(source).not.toMatch(/createEl\(\"span\"/);
        expect(source).not.toMatch(/\) as HTMLInputElement/);
    });

    it("uses the supported encryption capability check", () => {
        const source = readFileSync(
            resolve(import.meta.dirname, "../../../modules/features/SettingDialogue/ObsidianLiveSyncSettingTab.ts"),
            "utf8",
        );
        expect(source).not.toContain("testCrypt");
        expect(source).toContain("testEncryptionFeature");
    });

    it("does not trust untyped JSON response values", () => {
        const source = readSource("CmdAIAgent.ts");
        expect(source).not.toMatch(/const data = await res\.json;/);
    });
});
