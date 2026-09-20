import { afterEach, describe, expect, it } from "vitest";

import { englishMessageTranslator } from "@vrtmrz/livesync-commonlib/context";
import { $msg, setLang, translateLiveSyncMessage } from "@/common/translation";
import { SUPPORTED_I18N_LANGS } from "@/common/rosetta";
import { liveSyncProvisionalEnglishMessages } from "@/common/messages/LiveSyncProvisionalMessages";

describe("LiveSync-owned translation catalogue", () => {
    afterEach(() => setLang("def"));

    it("selects a translated language without delegating catalogue ownership to Commonlib", () => {
        setLang("es");

        expect(translateLiveSyncMessage("moduleCheckRemoteSize.optionIncreaseLimit", { newMax: "800" })).toBe(
            "aumentar a 800MB"
        );
        expect(SUPPORTED_I18N_LANGS).toContain("es");
    });

    it("retains typed placeholder substitution", () => {
        expect($msg("moduleCheckRemoteSize.optionIncreaseLimit", { newMax: "800" }, "def")).toBe("increase to 800MB");
    });

    it("substitutes the Config Doctor dialogue instead of leaking or faking its placeholders", () => {
        // 中文弹窗曾经把问题清单写死在译文里，并整体丢掉 ${activateReason} / ${issues}，
        // 于是用户看到的是一份固定的、过期的清单（其中一条对应的规则已从规章移除）。
        const rendered = $msg("Doctor.Dialogue.Main", { activateReason: "updated", issues: "- 增强块大小" }, "zh");

        expect(rendered).toContain("updated");
        expect(rendered).toContain("- 增强块大小");
        expect(rendered).not.toContain("${");
        expect(rendered).not.toContain("为数据块计算修订版本");
    });

    it("uses Commonlib's canonical English when the application catalogue has no translation", () => {
        setLang("es");

        expect(translateLiveSyncMessage("Active Remote Type")).toBe(englishMessageTranslator("Active Remote Type"));
    });

    it("directs a compatibility pause to the dedicated review workflow", () => {
        expect(translateLiveSyncMessage("Replicator.Message.VersionUpFlash")).toBe(
            "Remote synchronisation is paused for compatibility review. Run the 'Review why synchronisation is paused' command for details and available actions."
        );
    });

    it("uses LiveSync-owned provisional English without extending Commonlib's message contract", () => {
        expect($msg("This file has unresolved conflicts.")).toBe("This file has unresolved conflicts.");
        expect($msg("More actions for ${DEVICE}", { DEVICE: "phone" })).toBe("More actions for phone");
        expect($msg("Connection settings")).toBe("Connection settings");
        expect($msg("Saved connections")).toBe("Saved connections");
        expect(
            $msg("This file has ${COUNT} unresolved versions. They will be reviewed one pair at a time.", {
                COUNT: "3",
            })
        ).toBe("This file has 3 unresolved versions. They will be reviewed one pair at a time.");
        expect(translateLiveSyncMessage("This file has unresolved conflicts.")).toBe(
            "This file has unresolved conflicts."
        );
    });

    it("keeps the additional-device P2P Fetch explanation in the LiveSync-owned provisional catalogue", () => {
        expect(liveSyncProvisionalEnglishMessages).toMatchObject({
            "Setup Complete: Preparing to Fetch from Another Device":
                "Setup Complete: Preparing to Fetch from Another Device",
            "The P2P connection has been configured successfully. The initial synchronisation data must now be fetched from an online source device.":
                "The P2P connection has been configured successfully. The initial synchronisation data must now be fetched from an online source device.",
            "After restarting, select an online source device for the initial Fetch. The local LiveSync database on this device will be rebuilt from that source. Unsynchronised files in this Vault may conflict with the fetched data.":
                "After restarting, select an online source device for the initial Fetch. The local LiveSync database on this device will be rebuilt from that source. Unsynchronised files in this Vault may conflict with the fetched data.",
            "Restart this device, then choose the source device when P2P Rebuild opens.":
                "Restart this device, then choose the source device when P2P Rebuild opens.",
            "Restart and Select Source Device": "Restart and Select Source Device",
            "P2P Status pane": "P2P Status pane",
        });
    });
});
