import { existsSync, readFileSync, writeFileSync } from "fs";

// During npm's `version` lifecycle the package.json has already been updated,
// while a parent npm process on Windows may leak its own npm_package_version.
// Prefer the package version whenever this script runs in a package directory;
// direct metadata tests without package.json use npm_package_version instead.
const packageVersion = existsSync("package.json")
    ? JSON.parse(readFileSync("package.json", "utf8")).version
    : undefined;
const targetVersion = packageVersion || process.env.npm_package_version;
if (typeof targetVersion !== "string" || !targetVersion.trim()) {
    throw new Error("A release version is required.");
}

// read minAppVersion from manifest.json and bump version to target version
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, 4));

// update versions.json with target version and minAppVersion from manifest.json
// but only if the target version is not already in versions.json
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
if (!(targetVersion in versions)) {
    versions[targetVersion] = minAppVersion;
    writeFileSync("versions.json", JSON.stringify(versions, null, 4));
}
