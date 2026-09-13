import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const accountModalSource = readFileSync(
    fileURLToPath(new URL("./AIAgentAccountModal.ts", import.meta.url)),
    "utf8"
);
const floatingSource = readFileSync(
    fileURLToPath(new URL("./AIAgentFloating.ts", import.meta.url)),
    "utf8"
);
const pluginStyles = readFileSync(
    fileURLToPath(new URL("../../../../styles.css", import.meta.url)),
    "utf8"
);

describe("AI feature static styles", () => {
    it("loads account and floating controls from the plugin stylesheet", () => {
        expect(accountModalSource).not.toContain('createElement("style")');
        expect(floatingSource).not.toContain('createElement("style")');
        expect(pluginStyles).toContain(".ai-account-badge");
        expect(pluginStyles).toContain(".ai-float-ball-root");
    });
});
