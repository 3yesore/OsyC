import { describe, expect, it } from "vitest";
import { OsyCLogger } from "./osycLogger";

describe("OsyC logger", () => {
    it("keeps a bounded, redacted report for mobile diagnostics", () => {
        const logger = new OsyCLogger({ maxEntries: 2 });
        logger.error("mount failed", new Error("secret-token=abc123"));
        logger.info("second event");
        logger.warn("third event", { apiKey: "sk-secret", detail: "visible" });

        const entries = logger.entries();
        expect(entries).toHaveLength(2);
        expect(entries[0].message).toContain("second event");
        expect(entries[1].message).toContain("third event");
        expect(logger.report()).not.toContain("abc123");
        expect(logger.report()).not.toContain("sk-secret");
        expect(logger.report()).toContain("OsyC diagnostic log");
    });
});
