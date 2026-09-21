import { describe, expect, it } from "vitest";
import { OsyCLogger, redactSensitiveText } from "./osycLogger";

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

    it("accumulates many entries and exports all of them in the report", () => {
        const logger = new OsyCLogger();
        for (let index = 0; index < 12; index += 1) logger.info(`事件-${index}`);

        expect(logger.entries()).toHaveLength(12);
        const report = logger.report();
        expect(report).toContain("entries=12");
        for (let index = 0; index < 12; index += 1) expect(report).toContain(`事件-${index}`);
    });

    it("keeps only the newest entries once the ring buffer is full", () => {
        const logger = new OsyCLogger({ maxEntries: 3 });
        for (let index = 0; index < 6; index += 1) logger.info(`事件-${index}`);

        expect(logger.entries().map((entry) => entry.message)).toEqual(["事件-3", "事件-4", "事件-5"]);
        // report(maxEntries) 只导出最近 N 条，但 entries=N 仍反映完整缓冲长度。
        const tail = logger.report(2);
        expect(tail).toContain("entries=3");
        expect(tail).not.toContain("事件-3");
        expect(tail).toContain("事件-4");
        expect(tail).toContain("事件-5");
    });

    it("records API failures as path + status only, redacting query credentials", () => {
        const logger = new OsyCLogger({ maxApiFailures: 2 });
        logger.recordApiFailure("/api/send", 500);
        logger.recordApiFailure("/api/status?token=abcd1234", 401);
        logger.recordApiFailure("/api/pro/namespace", 403);

        const failures = logger.apiFailures();
        expect(failures).toHaveLength(2);
        expect(failures[0].path).toBe("/api/status?token=[REDACTED]");
        expect(failures[0].status).toBe(401);
        expect(failures[1].path).toBe("/api/pro/namespace");
        expect(JSON.stringify(failures)).not.toContain("abcd1234");
    });

    it("clear() empties both the log buffer and the API failure buffer", () => {
        const logger = new OsyCLogger();
        logger.info("one");
        logger.recordApiFailure("/api/send", 500);
        logger.clear();
        expect(logger.entries()).toHaveLength(0);
        expect(logger.apiFailures()).toHaveLength(0);
        expect(logger.report()).toContain("entries=0");
    });

    it("redacts setup URIs, bearer headers, card keys and passphrases", () => {
        const text = redactSensitiveText(
            [
                "obsidian://setupsync?setup=SUPERSECRETVALUE",
                "Authorization: Bearer sk-live-abcdef123456",
                "card_key=CARD-SECRET-9999",
                "passphrase: my-secret-pass",
            ].join(" | ")
        );
        expect(text).not.toContain("SUPERSECRETVALUE");
        expect(text).not.toContain("sk-live-abcdef123456");
        expect(text).not.toContain("CARD-SECRET-9999");
        expect(text).not.toContain("my-secret-pass");
        expect(text).toContain("[REDACTED_SETUP_URI]");
    });

    it("never lets a setup URI leak through a log entry", () => {
        const logger = new OsyCLogger();
        logger.warn("setup uri 应用失败", "obsidian://setupsync?setup=SUPERSECRETVALUE");
        expect(logger.report()).not.toContain("SUPERSECRETVALUE");
    });
});
