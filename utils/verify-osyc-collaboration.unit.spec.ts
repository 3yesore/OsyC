import { describe, expect, it } from "vitest";
import { BRAT_ASSETS, validateCollaborationState } from "./verify-osyc-collaboration.mjs";

function alignedInput() {
    const version = "1.0.75";
    return {
        ledger: {
            schemaVersion: 1,
            releaseOwner: "release-captain",
            currentStable: { version, tag: version, status: "published", assets: BRAT_ASSETS },
            publicationRules: { singleWriter: "release-captain" },
            sourceRepository: { commit: "921e6d5a" },
            distributionRepository: { commit: "a1f1085" },
        },
        source: {
            packageJson: { version },
            manifest: { version },
            betaManifest: { version },
            versions: { [version]: "1.7.2" },
            mainSource: `build ${version}`,
            stylesSource: "css",
        },
    };
}

describe("OsyC collaboration state", () => {
    it("accepts an aligned stable release", () => {
        expect(validateCollaborationState(alignedInput())).toEqual([]);
    });

    it("reports release ownership and metadata drift", () => {
        const input = alignedInput();
        input.ledger.releaseOwner = "feature-agent";
        input.ledger.currentStable.tag = "1.0.74";
        input.source.manifest.version = "1.0.74";
        expect(validateCollaborationState(input)).toEqual(expect.arrayContaining([
            "release ledger stable tag mismatch",
            "release ledger releaseOwner must be release-captain",
            "manifest.json version mismatch",
        ]));
    });

    it("checks the optional distribution tree", () => {
        const input = alignedInput();
        input.distribution = {
            manifest: { version: "1.0.74" },
            betaManifest: { version: "1.0.75" },
            versions: { "1.0.75": "1.7.2" },
            mainSource: "build 1.0.75",
            stylesSource: "css",
        };
        expect(validateCollaborationState(input)).toContain("distribution manifest.json version mismatch");
    });

    it("allows documentation commits after the reviewed release commit", () => {
        const input = alignedInput();
        input.checkRefs = true;
        input.sourceCommitMatches = true;
        expect(validateCollaborationState(input)).toEqual([]);
    });

    it("reports a checkout that is unrelated to the ledger commit", () => {
        const input = alignedInput();
        input.checkRefs = true;
        input.sourceCommitMatches = false;
        expect(validateCollaborationState(input)).toContain("source HEAD does not match release ledger commit");
    });
});
