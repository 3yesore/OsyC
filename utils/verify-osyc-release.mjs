import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_ENDPOINTS = ["/api/send", "/api/task/", "/api/status", "/api/sync/handshake", "/api/runtime-info"];

export function validateReleaseContract(input) {
    const errors = [];
    const version = input.version;
    if (input.packageJson?.version !== version) errors.push("package.json version mismatch");
    if (input.manifest?.version !== version) errors.push("manifest.json version mismatch");
    if (input.betaManifest?.version !== version) errors.push("manifest-beta.json version mismatch");
    if (input.versions?.[version] === undefined) errors.push("versions.json missing version");
    if (typeof input.mainSource !== "string" || !input.mainSource.includes(version)) {
        errors.push("main.js missing injected version");
    }
    for (const endpoint of REQUIRED_ENDPOINTS) {
        if (typeof input.mainSource !== "string" || !input.mainSource.includes(endpoint)) {
            errors.push(`main.js missing API endpoint ${endpoint}`);
        }
    }
    return errors;
}

async function readJson(path) {
    return JSON.parse(await readFile(path, "utf8"));
}

async function main() {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const packageJson = await readJson(`${root}/package.json`);
    const input = {
        version: packageJson.version,
        packageJson,
        manifest: await readJson(`${root}/manifest.json`),
        betaManifest: await readJson(`${root}/manifest-beta.json`),
        versions: await readJson(`${root}/versions.json`),
        mainSource: await readFile(`${root}/main.js`, "utf8"),
    };
    const errors = validateReleaseContract(input);
    if (errors.length > 0) {
        console.error(errors.join("\n"));
        process.exitCode = 1;
        return;
    }
    console.log(`OsyC release contract aligned: ${input.version}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
