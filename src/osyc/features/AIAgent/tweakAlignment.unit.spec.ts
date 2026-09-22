/**
 * 阴阳对照：tweak 差异计算 + 诊断自证 + 自愈分级。
 *
 * 现场事故（租户 3YESORE-CENTCOLYS）：iOS 设备 encrypt=true 与云端 PREFERRED
 * encrypt=false 不一致，commonlib 的 ensureDatabaseIsCompatible 返回 MISMATCHED，
 * 复制直接中止；而 2.0.18 的「修复同步配置」只认 customChunkSize / remoteType，
 * 于是报「同步配置已是最新，无需修复」。本 spec 锁死修复后的行为。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
    TWEAK_ALIGNMENT_KEYS,
    buildTweakAlignWarning,
    buildTweakDiffRecord,
    classifyTweakKey,
    filterAlignmentPatch,
    planTweakAlignment,
    tweakAlignmentOptionsForRemote,
} from "./tweakAlignment";
import {
    buildLiveSyncDiagnosticSummary,
    buildTweakDiffRows,
    describeRemotePreferredStatus,
    summarizeSyncDiagnostics,
    tweakAlignmentAction,
} from "./livesyncSyncActions";
import {
    TweakValuesDefault,
    TweakValuesShouldMatchedTemplate,
} from "@vrtmrz/livesync-commonlib/compat/common/models/tweak.definition";

const uiSource = readFileSync(fileURLToPath(new URL("../../serviceFeatures/useAIAgentUI.ts", import.meta.url)), "utf8");
const modalSource = readFileSync(fileURLToPath(new URL("./AIAgentAccountModal.ts", import.meta.url)), "utf8");
const paneSource = readFileSync(fileURLToPath(new URL("./AIAgentPaneView.ts", import.meta.url)), "utf8");

/** 与远端 PREFERRED 逐键全等的基线：must-match 模板 + TweakValuesDefault 补齐默认值。 */
function baseTweaks(): Record<string, unknown> {
    return { ...TweakValuesShouldMatchedTemplate, ...TweakValuesDefault } as Record<string, unknown>;
}

/** 造一个与基线不同的值（布尔取反 / 数字 +1 / 字符串换名）。 */
function mutate(key: string, base: Record<string, unknown>): Record<string, unknown> {
    const value = base[key];
    const next: Record<string, unknown> = { ...base };
    if (typeof value === "boolean") next[key] = !value;
    else if (typeof value === "number") next[key] = value + 1;
    else next[key] = "DIFFERENT_VALUE";
    return next;
}

describe("planTweakAlignment 阴阳对照", () => {
    it("阴：encrypt true（本机）vs false（云端）→ incompatible + requiresUserConfirmation，且绝不是 no-op", () => {
        const local = { ...baseTweaks(), encrypt: true };
        const preferred = { ...baseTweaks(), encrypt: false };
        const plan = planTweakAlignment(local, preferred);
        expect(plan.available).toBe(true);
        expect(plan.noop).toBe(false);
        expect(plan.requiresUserConfirmation).toBe(true);
        expect(plan.diffs).toEqual([{ key: "encrypt", local: true, preferred: false, kind: "incompatible" }]);
        expect(plan.incompatible.map((diff) => diff.key)).toEqual(["encrypt"]);
        expect(plan.compatibleLossy).toEqual([]);
        // incompatible 差异绝不允许走静默补丁。
        expect(plan.silentPatch).toEqual({});
        expect(buildTweakAlignWarning(plan)).toContain("端到端加密");
    });

    it("阳：本机与云端逐键全等 → 真正的 no-op（无差异、无需确认）", () => {
        const same = baseTweaks();
        const plan = planTweakAlignment(same, { ...same });
        expect(plan.available).toBe(true);
        expect(plan.noop).toBe(true);
        expect(plan.diffs).toEqual([]);
        expect(plan.requiresUserConfirmation).toBe(false);
        expect(plan.silentPatch).toEqual({});
        expect(buildTweakDiffRows(plan.diffs)).toEqual([]);
    });

    it("compatible-lossy：customChunkSize 60 vs 0 → 静默对齐补丁，不要求确认", () => {
        const plan = planTweakAlignment({ ...baseTweaks(), customChunkSize: 60 }, { ...baseTweaks(), customChunkSize: 0 });
        expect(plan.noop).toBe(false);
        expect(plan.requiresUserConfirmation).toBe(false);
        expect(plan.diffs).toEqual([{ key: "customChunkSize", local: 60, preferred: 0, kind: "compatible-lossy" }]);
        expect(plan.silentPatch).toEqual({ customChunkSize: 0 });
        expect(plan.alignedValues).toEqual({ customChunkSize: 0 });
    });

    it("读不到远端 PREFERRED 时 available=false 且 noop=false（没证据就不许说无差异）", () => {
        for (const missing of [null, undefined, "not-an-object", 42]) {
            const plan = planTweakAlignment(baseTweaks(), missing);
            expect(plan.available).toBe(false);
            expect(plan.noop).toBe(false);
            expect(plan.diffs).toEqual([]);
        }
    });

    it("任一侧未设置的键不判差异，与 isObjectDifferent(..., true) 的真实判定一致", () => {
        const plan = planTweakAlignment({}, { encrypt: false });
        expect(plan.diffs).toEqual([]);
    });

    it("覆盖 commonlib 的全部 18 个 must-match 键，且每个键都能被判成差异", () => {
        expect(TWEAK_ALIGNMENT_KEYS).toEqual(Object.keys(TweakValuesShouldMatchedTemplate));
        expect(TWEAK_ALIGNMENT_KEYS).toHaveLength(18);
        expect(TWEAK_ALIGNMENT_KEYS).toContain("encrypt");
        expect(TWEAK_ALIGNMENT_KEYS).toContain("usePathObfuscation");
        expect(TWEAK_ALIGNMENT_KEYS).toContain("handleFilenameCaseSensitive");
        expect(TWEAK_ALIGNMENT_KEYS).toContain("E2EEAlgorithm");
        for (const key of TWEAK_ALIGNMENT_KEYS) {
            const base = baseTweaks();
            const plan = planTweakAlignment(base, mutate(key, base));
            expect(plan.diffs.map((diff) => diff.key)).toEqual([key]);
        }
    });

    it("分级与 commonlib 的 CompatibleButLossyChanges / IncompatibleChanges 边界一致", () => {
        for (const key of ["hashAlg", "customChunkSize", "chunkSplitterVersion"]) {
            expect(classifyTweakKey(key)).toBe("compatible-lossy");
        }
        for (const key of ["encrypt", "usePathObfuscation", "useDynamicIterationCount", "handleFilenameCaseSensitive"]) {
            expect(classifyTweakKey(key)).toBe("incompatible");
        }
        // 未归类的 must-match 键保守按 incompatible 处理：静默改写同样可能丢数据。
        expect(classifyTweakKey("E2EEAlgorithm")).toBe("incompatible");
        expect(classifyTweakKey("enableCompression")).toBe("incompatible");
    });
});

describe("诊断载荷必须能自证 tweak 握手失败", () => {
    it("阳：tweak_diff / remote_preferred_status / tweak_settings_mismatched 出现在上传载荷里", () => {
        const local = { ...baseTweaks(), encrypt: true };
        const diffs = planTweakAlignment(local, { ...baseTweaks(), encrypt: false }).diffs;
        const summary = buildLiveSyncDiagnosticSummary(
            { remotePreferredStatus: "available", tweakDiff: diffs, tweakSettingsMismatched: true },
            local
        );
        expect(summary.tweak_diff).toEqual({ encrypt: { local: true, preferred: false } });
        expect(summary.remote_preferred_status).toBe("available");
        expect(summary.tweak_settings_mismatched).toBe(true);
        // 旧行为的反例：error 仍然是 null —— 所以必须靠这三个新字段自证。
        expect(summary.error).toBeNull();
    });

    it("阴：没有差异时 tweak_diff 为空对象，而不是缺字段", () => {
        const summary = buildLiveSyncDiagnosticSummary(
            { remotePreferredStatus: "available", tweakDiff: [], tweakSettingsMismatched: false },
            baseTweaks()
        );
        expect(summary.tweak_diff).toEqual({});
        expect(summary.tweak_settings_mismatched).toBe(false);
    });

    it("未检查远端时三个字段为中性值（null / 空对象 / null）", () => {
        const summary = buildLiveSyncDiagnosticSummary({}, baseTweaks());
        expect(summary.tweak_diff).toEqual({});
        expect(summary.remote_preferred_status).toBeNull();
        expect(summary.tweak_settings_mismatched).toBeNull();
    });

    it("诊断视图逐条列出本机值 vs 云端值，并给出唯一推荐动作", () => {
        const diffs = planTweakAlignment(
            { ...baseTweaks(), encrypt: true },
            { ...baseTweaks(), encrypt: false }
        ).diffs;
        const view = summarizeSyncDiagnostics({
            remotePreferredStatus: "available",
            tweakDiff: diffs,
            tweakSettingsMismatched: true,
        });
        expect(view.tweakAlignRequired).toBe(true);
        expect(view.tweakDiffRows).toEqual([
            { key: "encrypt", label: "端到端加密", local: "true", preferred: "false", kind: "incompatible" },
        ]);
        expect(view.remotePreferredStatusLabel).toBe("已读取");
        const action = tweakAlignmentAction(view);
        expect(action).not.toBeNull();
        expect(action?.risk).toBe("danger");
        expect(action?.confirmMessage).toContain("端到端加密");
        expect(action?.confirmMessage).toContain("重建本地同步库");
    });

    it("compatible-lossy 差异不给推荐动作（自愈已静默处理）", () => {
        const diffs = planTweakAlignment(
            { ...baseTweaks(), customChunkSize: 60 },
            { ...baseTweaks(), customChunkSize: 0 }
        ).diffs;
        const view = summarizeSyncDiagnostics({ remotePreferredStatus: "available", tweakDiff: diffs });
        expect(view.tweakDiffRows).toHaveLength(1);
        expect(view.tweakAlignRequired).toBe(false);
        expect(tweakAlignmentAction(view)).toBeNull();
    });

    it("远端状态有明确中文标签", () => {
        expect(describeRemotePreferredStatus("available")).toBe("已读取");
        expect(describeRemotePreferredStatus("not-configured")).toBe("云端未保存同步参数");
        expect(describeRemotePreferredStatus("unavailable")).toContain("读取失败");
        expect(describeRemotePreferredStatus(undefined)).toBe("未检查");
    });

    it("buildTweakDiffRecord 保留布尔 / 数字 / 字符串原类型", () => {
        const record = buildTweakDiffRecord(
            planTweakAlignment(
                { ...baseTweaks(), encrypt: true, customChunkSize: 60 },
                { ...baseTweaks(), encrypt: false, customChunkSize: 0 }
            ).diffs
        );
        expect(record).toEqual({
            encrypt: { local: true, preferred: false },
            customChunkSize: { local: 60, preferred: 0 },
        });
    });
});

describe("官方托管远端自动对齐（需求变更：不允许让客户手动解决）", () => {
    it("官方远端：encrypt true vs false → 自动对齐（requiresUserConfirmation === false），对齐后差异为空", () => {
        const plan = planTweakAlignment(
            { encrypt: true },
            { encrypt: false },
            tweakAlignmentOptionsForRemote(true)
        );
        expect(plan.autoAlign).toBe(true);
        expect(plan.requiresUserConfirmation).toBe(false);
        expect(plan.diffs).toEqual([{ key: "encrypt", local: true, preferred: false, kind: "incompatible" }]);
        // 应用 alignedValues 后差异为空 —— 这就是「自动对齐」的可验证定义。
        const after = { ...{ encrypt: true }, ...plan.alignedValues };
        expect(planTweakAlignment(after, { encrypt: false }).noop).toBe(true);
        expect(planTweakAlignment(after, { encrypt: false }).diffs).toEqual([]);
    });

    it("官方远端：完整基线只差 encrypt 时也自动对齐，且对齐后 noop", () => {
        const local = { ...baseTweaks(), encrypt: true };
        const preferred = { ...baseTweaks(), encrypt: false };
        const plan = planTweakAlignment(local, preferred, tweakAlignmentOptionsForRemote(true));
        expect(plan.autoAlign).toBe(true);
        expect(plan.requiresUserConfirmation).toBe(false);
        expect(plan.alignedValues).toEqual({ encrypt: false });
        expect(planTweakAlignment({ ...local, ...plan.alignedValues }, preferred).noop).toBe(true);
    });

    it("非官方远端：同样输入不自动改，仍然是用户确认后才对齐", () => {
        const plan = planTweakAlignment(
            { encrypt: true },
            { encrypt: false },
            tweakAlignmentOptionsForRemote(false)
        );
        expect(plan.autoAlign).toBe(false);
        expect(plan.requiresUserConfirmation).toBe(true);
        // 不得留下任何可静默写入的补丁。
        expect(plan.silentPatch).toEqual({});
    });

    it("默认（不传选项）等价于非官方远端：绝不默认自动关掉用户的 E2EE", () => {
        const plan = planTweakAlignment({ encrypt: true }, { encrypt: false });
        expect(plan.autoAlign).toBe(false);
        expect(plan.requiresUserConfirmation).toBe(true);
    });

    it("安全边界：自动对齐补丁永不包含 passphrase / 凭据类键", () => {
        const patch = filterAlignmentPatch({
            encrypt: false,
            customChunkSize: 0,
            passphrase: "secret",
            encryptedPassphrase: "enc",
            encryptedCouchDBConnection: "enc2",
            couchDB_PASSWORD: "pw",
            couchDB_URI: "https://example.com",
            secretKey: "sk",
        });
        expect(patch).toEqual({ encrypt: false, customChunkSize: 0 });
    });

    it("接线只对官方托管远端开启自动对齐，并复用 LiveSync 的「使用远端」分支", () => {
        expect(uiSource).toContain("isOfficialManagedRemote");
        expect(uiSource).toContain("tweakAlignmentOptionsForRemote(true)");
        expect(uiSource).toContain("extractObject(TweakValuesTemplate, preferred.values)");
        expect(uiSource).toContain("setPreferredRemoteTweakSettings(settings)");
        expect(uiSource).toContain("core.rebuilder.$fetchLocal()");
        // 一条日志说清改了什么 / 远端状态 / 是否需要重建。
        expect(uiSource).toContain("aligned: outcome.aligned");
        expect(uiSource).toContain("remote_preferred: outcome.remotePreferred");
        expect(uiSource).toContain("rebuild: outcome.rebuild");
    });

    it("四个自愈时机都在：启动 / 激活 / 打开面板 / 每次 pull 之前", () => {
        expect(uiSource).toContain('void runReplicationRepair("startup")');
        expect(uiSource).toContain('runReplicationRepair("activation")');
        expect(uiSource).toContain('autoAlignOfficialRemoteTweaks("before-pull")');
        expect(uiSource).toContain("agent.livesyncControl?.reconcileSyncConfiguration()");
        expect(paneSource).toContain("this.onPaneOpened?.()");
    });
});

describe("接线与 UI 契约（源码级锁死）", () => {
    it("存在任何差异时不得再出现「同步配置已是最新，无需修复」", () => {
        expect(uiSource).not.toContain("同步配置已是最新，无需修复");
        expect(modalSource).not.toContain("同步配置已是最新，无需修复");
    });

    it("自愈读取远端 PREFERRED，并复用 LiveSync 自己的重建路径", () => {
        expect(uiSource).toContain("getRemotePreferredTweakValues");
        expect(uiSource).toContain("readRemotePreferredTweakValues");
        expect(uiSource).toContain("async alignTweaksToRemote()");
        expect(uiSource).toContain("core.rebuilder.$fetchLocal()");
        // incompatible 分支必须提前返回，不写设置也不拉取。
        expect(uiSource).toContain("requiresUserConfirmation");
    });

    it("同步区把差异逐条列出并提供唯一推荐动作按钮", () => {
        expect(modalSource).toContain("view.tweakDiffRows");
        expect(modalSource).toContain("tweakAlignmentAction(view)");
        expect(modalSource).toContain("control.alignTweaksToRemote()");
        expect(modalSource).toContain("confirmLiveSyncAction(alignAction, alignAction.confirmMessage)");
    });
});
