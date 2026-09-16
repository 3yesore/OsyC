import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const BRAT_ASSETS = ["main.js", "manifest.json", "manifest-beta.json", "styles.css", "versions.json"];

function checkPackage(input, version, errors) {
    if (input.packageJson?.version !== version) errors.push("package.json version mismatch");
    if (input.manifest?.version !== version) errors.push("manifest.json version mismatch");
    if (input.betaManifest?.version !== version) errors.push("manifest-beta.json version mismatch");
    if (input.versions?.[version] === undefined) errors.push("versions.json missing current stable version");
    if (typeof input.mainSource !== "string" || !input.mainSource.includes(version)) {
        errors.push("main.js missing current stable version");
    }
    if (typeof input.stylesSource !== "string") errors.push("styles.css is missing");
}

function checkDistribution(input, version, errors) {
    if (input.manifest?.version !== version) errors.push("distribution manifest.json version mismatch");
    if (input.betaManifest?.version !== version) errors.push("distribution manifest-beta.json version mismatch");
    if (input.versions?.[version] === undefined) errors.push("distribution versions.json missing current stable version");
    if (typeof input.mainSource !== "string" || !input.mainSource.includes(version)) {
        errors.push("distribution main.js missing current stable version");
    }
    if (typeof input.stylesSource !== "string") errors.push("distribution styles.css is missing");
}

export function validateCollaborationState(input) {
    const errors = [];
    const ledger = input.ledger;
    const current = ledger?.currentStable;
    const stableVersion = current?.version;

    if (ledger?.schemaVersion !== 1) errors.push("release ledger schemaVersion must be 1");
    if (!stableVersion || typeof stableVersion !== "string") {
        errors.push("release ledger current stable version is missing");
        return errors;
    }
    if (current.tag !== stableVersion) errors.push("release ledger stable tag mismatch");
    if (current.status !== "published") errors.push("release ledger current stable release is not published");
    if (!Array.isArray(current.assets) || current.assets.join("|") !== BRAT_ASSETS.join("|")) {
        errors.push("release ledger BRAT asset list mismatch");
    }
    if (ledger.releaseOwner !== "release-captain") errors.push("release ledger releaseOwner must be release-captain");
    if (ledger.publicationRules?.singleWriter !== "release-captain") {
        errors.push("release ledger singleWriter must be release-captain");
    }

    // A reserved candidate line legitimately sits ahead of the stable release,
    // so the reviewed working tree carries the candidate version rather than
    // the stable one. Accept either, but never a version the ledger does not
    // record: a tree that matches both the stable and the candidate version
    // still resolves to the stable line.
    const candidate = ledger.candidate;
    const candidateVersion = candidate?.version;
    if (typeof candidateVersion === "string" && candidate.tag != null) {
        if (candidate.tag !== candidateVersion) errors.push("release ledger candidate tag mismatch");
        if (typeof candidate.releaseUrl !== "string" || candidate.releaseUrl === "") {
            errors.push("release ledger tagged candidate has no release URL");
        }
    }
    const treeVersion = (input.source ?? input).manifest?.version;
    const version =
        typeof candidateVersion === "string" && candidateVersion !== stableVersion && treeVersion === candidateVersion
            ? candidateVersion
            : stableVersion;

    checkPackage(input.source ?? input, version, errors);
    if (input.distribution) checkDistribution(input.distribution, version, errors);

    if (input.checkRefs) {
        if (input.sourceCommitMatches === false) {
            errors.push("source HEAD does not match release ledger commit");
        }
        if (input.distributionCommitMatches === false) {
            errors.push("distribution HEAD does not match release ledger commit");
        }
    }
    return errors;
}

async function readJson(path) {
    return JSON.parse(await readFile(path, "utf8"));
}

async function readSource(root) {
    return {
        packageJson: await readJson(resolve(root, "package.json")),
        manifest: await readJson(resolve(root, "manifest.json")),
        betaManifest: await readJson(resolve(root, "manifest-beta.json")),
        versions: await readJson(resolve(root, "versions.json")),
        mainSource: await readFile(resolve(root, "main.js"), "utf8"),
        stylesSource: await readFile(resolve(root, "styles.css"), "utf8"),
    };
}

async function readDistribution(root) {
    return {
        manifest: await readJson(resolve(root, "manifest.json")),
        betaManifest: await readJson(resolve(root, "manifest-beta.json")),
        versions: await readJson(resolve(root, "versions.json")),
        mainSource: await readFile(resolve(root, "main.js"), "utf8"),
        stylesSource: await readFile(resolve(root, "styles.css"), "utf8"),
    };
}

function gitHead(path) {
    return execFileSync("git", ["-C", path, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

function gitContains(path, commit) {
    try {
        execFileSync("git", ["-C", path, "merge-base", "--is-ancestor", commit, "HEAD"], { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

async function main() {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const args = process.argv.slice(2);
    const distributionFlag = args.indexOf("--distribution");
    const distributionPath = distributionFlag >= 0 ? args[distributionFlag + 1] : undefined;
    if (distributionFlag >= 0 && !distributionPath) throw new Error("--distribution requires a path");
    const checkRefs = args.includes("--check-refs");
    const ledger = await readJson(resolve(root, "docs/releases/release-ledger.json"));
    const input = { ledger, source: await readSource(root), checkRefs };
    if (distributionPath) input.distribution = await readDistribution(resolve(distributionPath));
    if (checkRefs) {
        input.sourceCommit = gitHead(root);
        input.sourceCommitMatches = gitContains(root, ledger.sourceRepository?.commit);
        if (distributionPath) {
            input.distributionCommit = gitHead(resolve(distributionPath));
            input.distributionCommitMatches = gitContains(resolve(distributionPath), ledger.distributionRepository?.commit);
        }
    }
    const errors = validateCollaborationState(input);
    if (errors.length > 0) {
        console.error(errors.join("\n"));
        process.exitCode = 1;
        return;
    }
    console.log(`OsyC collaboration state aligned: ${ledger.currentStable.version}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
