import { describe, expect, it } from "vitest";
import { validateReleaseContract } from "./verify-osyc-release.mjs";

describe("OsyC release contract", () => {
    it("accepts aligned package metadata and required API entry points", () => {
        expect(validateReleaseContract({
            version: "1.0.73",
            packageJson: { version: "1.0.73" },
            manifest: { version: "1.0.73" },
            betaManifest: { version: "1.0.73" },
            versions: { "1.0.73": "1.7.2" },
            mainSource: "const v = \"1.0.73\"; /api/send /api/task/ /api/status /api/sync/handshake /api/runtime-info",
        })).toEqual([]);
    });

    it("reports version drift and missing API entry points", () => {
        const errors = validateReleaseContract({
            version: "1.0.73",
            packageJson: { version: "1.0.70" },
            manifest: { version: "1.0.70" },
            betaManifest: { version: "1.0.70" },
            versions: {},
            mainSource: "old build",
        });
        expect(errors).toEqual(expect.arrayContaining([
            "package.json version mismatch",
            "manifest.json version mismatch",
            "manifest-beta.json version mismatch",
            "versions.json missing version",
            "main.js missing injected version",
            "main.js missing API endpoint /api/sync/handshake",
        ]));
    });
});
