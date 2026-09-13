import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFile(join(repo, name), "utf8");

test("repository exposes auditable plugin source", async () => {
  const sourceEntries = await readdir(join(repo, "src"), { withFileTypes: true, recursive: true });
  assert.ok(
    sourceEntries.some((entry) => entry.isFile() && /\.(ts|tsx|js|svelte)$/.test(entry.name)),
    "src/ must contain auditable TypeScript/JavaScript/Svelte source files",
  );
});

test("manifest description is a concise English action sentence", async () => {
  const manifest = JSON.parse(await read("manifest.json"));
  assert.match(manifest.description, /^[A-Za-z][^.!?]{10,119}[.!?]$/);
  assert.doesNotMatch(manifest.description.toLowerCase(), /^osyc\b/);
  assert.doesNotMatch(manifest.description.toLowerCase(), /\bobsidian\b/);
});

test("README discloses network, account, payment, server processing, and privacy policy", async () => {
  const readme = await read("README.md");
  for (const term of ["network", "account", "paid", "server", "privacy policy"]) {
    assert.match(readme.toLowerCase(), new RegExp(term));
  }
  assert.doesNotMatch(readme, /osyc\.example\.com/);
  assert.match(readme, /PRIVACY\.md/);
  assert.match(readme, /TERMS\.md/);
});

test("release workflow uploads only Obsidian-supported plugin assets", async () => {
  const workflow = await read(".github/workflows/publish-release-assets.yml");
  assert.match(workflow, /\['main\.js', 'application\/javascript'\]/);
  assert.match(workflow, /\['manifest\.json', 'application\/json'\]/);
  assert.match(workflow, /\['styles\.css', 'text\/css'\]/);
  assert.doesNotMatch(workflow, /\['manifest-beta\.json'/);
  assert.doesNotMatch(workflow, /\['versions\.json'/);
});
