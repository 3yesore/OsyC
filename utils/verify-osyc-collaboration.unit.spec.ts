import { describe, expect, it } from "vitest";
import { BRAT_ASSETS, validateCollaborationState } from "./verify-osyc-collaboration.mjs";

type LedgerCandidate = {
    version: string;
    tag?: string | null;
    releaseUrl?: string;
    status?: string;
} | null;

function alignedInput() {
    const version = "1.0.75";
    return {
        ledger: {
            schemaVersion: 1,
            releaseOwner: "release-captain",
            currentStable: { version, tag: version, status: "published", assets: BRAT_ASSETS },
            candidate: null as LedgerCandidate,
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

const candidateReleaseUrl = "https://github.com/3yesore/OsyC/releases/tag/1.0.76";

function candidateInput() {
    const input = alignedInput();
    input.ledger.candidate = {
        version: "1.0.76",
        tag: "1.0.76",
        releaseUrl: candidateReleaseUrl,
        status: "prerelease-published",
    };
    input.source.packageJson.version = "1.0.76";
    input.source.manifest.version = "1.0.76";
    input.source.betaManifest.version = "1.0.76";
    input.source.versions = { "1.0.76": "1.7.2" };
    input.source.mainSource = "build 1.0.76";
    return input;
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

    it("accepts a published candidate line ahead of the stable release", () => {
        expect(validateCollaborationState(candidateInput())).toEqual([]);
    });

    it("checks the distribution tree against the candidate line", () => {
        const input = candidateInput();
        input.distribution = {
            manifest: { version: "1.0.75" },
            betaManifest: { version: "1.0.76" },
            versions: { "1.0.76": "1.7.2" },
            mainSource: "build 1.0.76",
            stylesSource: "css",
        };
        expect(validateCollaborationState(input)).toContain("distribution manifest.json version mismatch");
    });

    it("reports a working tree that matches neither the stable nor the candidate version", () => {
        const input = candidateInput();
        input.source.packageJson.version = "1.0.77";
        input.source.manifest.version = "1.0.77";
        input.source.betaManifest.version = "1.0.77";
        expect(validateCollaborationState(input)).toEqual(expect.arrayContaining([
            "package.json version mismatch",
            "manifest.json version mismatch",
            "manifest-beta.json version mismatch",
        ]));
    });

    it("reports a moved candidate tag", () => {
        const input = candidateInput();
        input.ledger.candidate!.tag = "1.0.75";
        expect(validateCollaborationState(input)).toContain("release ledger candidate tag mismatch");
    });

    it("reports a tagged candidate without a release URL", () => {
        const input = candidateInput();
        input.ledger.candidate!.releaseUrl = "";
        expect(validateCollaborationState(input)).toContain("release ledger tagged candidate has no release URL");
    });

    it("still requires the stable release to stay published alongside a candidate", () => {
        const input = candidateInput();
        input.ledger.currentStable.status = "superseded";
        expect(validateCollaborationState(input)).toContain(
            "release ledger current stable release is not published",
        );
    });
});
