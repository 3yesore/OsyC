/**
 * 交互式冲突弹窗的中文文案门禁。
 *
 * 现场（iPhone 实测）：LiveSync 的「Conflicting changes」弹窗按钮全是英文，
 * 根因是 ConflictResolveModal.ts 直接把英文写字面量（第 138/142/179/184/188/193/198 行等），
 * 绕过了本仓已有的 $msg 消息表 —— zh-tw.yaml 里其实早有 “Not now: 暫不處理”。
 *
 * 本文件同时锁两件事：
 * 1. 阴阳对照：同一批消息键在 zh 下解析为中文、在 en（def）下解析回英文原文；
 * 2. 源码级：弹窗源码里不再出现任何未经 $msg(...) 包装的英文 UI 字面量。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CANCELLED, type diff_result, type FilePathWithPrefix } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { ConflictResolveModal } from "./ConflictResolveModal.ts";
import type { AllMessageKeys } from "@/common/rosetta";
import { $msg, setLang } from "@/common/translation";

vi.mock("@/deps.ts", () => ({
    App: class App {},
    Modal: class Modal {
        createdButtons: string[] = [];

        private createElement(): Record<string, unknown> {
            const element: Record<string, unknown> = {
                addClass: vi.fn(),
                addEventListener: vi.fn(),
                appendText: vi.fn(),
                classList: {
                    add: vi.fn(),
                    remove: vi.fn(),
                },
                empty: vi.fn(),
                querySelector: vi.fn(() => null),
                querySelectorAll: vi.fn(() => []),
                scrollIntoView: vi.fn(),
                setText: vi.fn(),
            };
            element.createDiv = vi.fn(() => this.createElement());
            element.createEl = vi.fn((_tag: string, _options?: unknown, callback?: (child: unknown) => void) => {
                if (_tag === "button" && typeof _options === "object" && _options !== null && "text" in _options) {
                    this.createdButtons.push(String((_options as { text: unknown }).text));
                }
                const child = this.createElement();
                callback?.(child);
                return child;
            });
            element.createSpan = vi.fn(() => this.createElement());
            return element;
        }

        contentEl = this.createElement();
        titleEl = {
            setText: vi.fn(),
        };

        close() {
            (this as { onClose?: () => void }).onClose?.();
        }
    },
}));

const conflict: diff_result = {
    left: { rev: "2-left", data: "left", ctime: 1, mtime: 2 },
    right: { rev: "2-right", data: "right", ctime: 1, mtime: 2 },
    diff: [],
};

/** 键名本身就是英文原文；这里用拼接避免在测试源码里出现占位符字面量。 */
const USE_VERSION_KEY = ["Use ", "$", "{name}"].join("") as AllMessageKeys;

const ZH_CASES: ReadonlyArray<readonly [AllMessageKeys, string]> = [
    ["Conflicting changes", "检测到冲突"],
    ["Pick a version", "选择版本"],
    ["Base", "基准版本"],
    ["Conflicted", "冲突版本"],
    ["Local", "本地"],
    ["Remote", "远端"],
    ["Vault and database revision", "保管库与数据库修订版本"],
    ["Vault file", "保管库文件"],
    ["Database revision", "数据库修订版本"],
    ["Prev", "上一个"],
    ["Next", "下一个"],
    ["Concat both", "合并保留两者"],
    ["Not now", "暂不处理"],
    ["Cancel", "取消"],
    ["Close", "关闭"],
    ["(Deleted)", "（已删除）"],
    ["(Too large diff to display)", "（差异过大，无法显示）"],
];

const ZH_TW_CASES: ReadonlyArray<readonly [AllMessageKeys, string]> = [
    ["Conflicting changes", "偵測到衝突"],
    ["Pick a version", "選擇版本"],
    ["Base", "基準版本"],
    ["Conflicted", "衝突版本"],
    ["Local", "本機"],
    ["Remote", "遠端"],
    ["Vault and database revision", "儲存庫與資料庫修訂版本"],
    ["Vault file", "儲存庫檔案"],
    ["Database revision", "資料庫修訂版本"],
    ["Prev", "上一個"],
    ["Next", "下一個"],
    ["Concat both", "合併保留兩者"],
    ["Not now", "暫不處理"],
    ["Cancel", "取消"],
    ["Close", "關閉"],
    ["(Deleted)", "（已刪除）"],
    ["(Too large diff to display)", "（差異過大，無法顯示）"],
];

/** 弹窗会用到的全部英文 UI 文案；它们只能作为 $msg 的键出现。 */
const UI_PHRASES: readonly string[] = [
    "Conflicting changes",
    "Pick a version",
    "Base",
    "Conflicted",
    "Local",
    "Remote",
    "Vault and database revision",
    "Vault file",
    "Database revision",
    "Prev",
    "Next",
    USE_VERSION_KEY,
    "Concat both",
    "Not now",
    "Cancel",
    "Close",
    "(Deleted)",
    "(Too large diff to display)",
];

const conflictModalSource = readFileSync(fileURLToPath(new URL("./ConflictResolveModal.ts", import.meta.url)), "utf8");

type RecordingModal = ConflictResolveModal & { createdButtons: string[] };

function openModal(options: {
    pluginPickMode?: boolean;
    remoteName?: string;
    readOnly?: boolean;
    title?: string;
    localName?: string;
    dialogRemoteName?: string;
}): RecordingModal {
    const ModalClass = ConflictResolveModal as unknown as new (...args: unknown[]) => RecordingModal;
    const modal = new ModalClass(
        {},
        "note.md",
        { ...conflict, diff: [] },
        options.pluginPickMode ?? false,
        options.remoteName,
        options.readOnly
            ? {
                  readOnly: true,
                  title: options.title,
                  localName: options.localName,
                  remoteName: options.dialogRemoteName,
              }
            : undefined
    );
    modal.onOpen();
    return modal;
}

describe("ConflictResolveModal：中文文案阴阳对照", () => {
    afterEach(() => setLang("def"));

    it("zh：全部弹窗文案解析为简体中文", () => {
        for (const [key, expected] of ZH_CASES) {
            expect($msg(key, {}, "zh"), key).toBe(expected);
        }
        expect($msg(USE_VERSION_KEY, { name: "基准版本" }, "zh")).toBe("使用基准版本");
    });

    it("zh-tw：全部弹窗文案解析为繁体中文", () => {
        for (const [key, expected] of ZH_TW_CASES) {
            expect($msg(key, {}, "zh-tw"), key).toBe(expected);
        }
        expect($msg(USE_VERSION_KEY, { name: "基準版本" }, "zh-tw")).toBe("使用基準版本");
    });

    it("en（def）：全部弹窗文案解析回英文原文 —— 阴性对照的另一半", () => {
        for (const [key] of ZH_CASES) {
            expect($msg(key, {}, "def"), key).toBe(key);
        }
        expect($msg(USE_VERSION_KEY, { name: "Base" }, "def")).toBe("Use Base");
    });

    it("简体中文下渲染出的按钮与标题全部是中文", () => {
        setLang("zh");
        const modal = openModal({});
        expect(modal.title).toBe("检测到冲突");
        expect(modal.createdButtons).toEqual([
            "▲ 上一个",
            "▼ 下一个",
            "使用基准版本",
            "使用冲突版本",
            "合并保留两者",
            "暂不处理",
        ]);
        modal.close();
    });

    it("简体中文下只读对比弹窗与插件版本选择弹窗同样是中文", () => {
        setLang("zh");
        const readOnlyModal = openModal({ readOnly: true });
        expect(readOnlyModal.title).toBe("保管库与数据库修订版本");
        expect(readOnlyModal.createdButtons).toEqual(["▲ 上一个", "▼ 下一个", "关闭"]);
        readOnlyModal.close();

        const pickModal = openModal({ pluginPickMode: true, remoteName: "术语表" });
        expect(pickModal.title).toBe("选择版本");
        expect(pickModal.createdButtons).toEqual(["▲ 上一个", "▼ 下一个", "使用本地", "使用术语表", "取消"]);
        pickModal.close();
    });

    it("源码里每个英文 UI 短语都只能作为 $msg(...) 的键出现，不得硬编码输出", () => {
        for (const phrase of UI_PHRASES) {
            const quoted = '"' + phrase + '"';
            const firstIndex = conflictModalSource.indexOf(quoted);
            expect(firstIndex, "源码里找不到 i18n 键 " + quoted).toBeGreaterThan(-1);
            let index = firstIndex;
            while (index !== -1) {
                const preceding = conflictModalSource.slice(Math.max(0, index - 5), index);
                expect(preceding, quoted + " 出现在了非 $msg(...) 的位置").toBe("$msg(");
                index = conflictModalSource.indexOf(quoted, index + 1);
            }
        }
    });

    it("源码里没有任何 text: 选项直接输出英文字面量", () => {
        const doubleQuoted = [...conflictModalSource.matchAll(/\btext:\s*"([^"]*)"/g)].map((match) => match[1]);
        expect(doubleQuoted.filter((value) => /[A-Za-z]/.test(value))).toEqual([]);

        // 反引号模板选项（如 “▲ Prev”）必须把文案包在 $msg(...) 里。
        const backQuoted = [...conflictModalSource.matchAll(/\btext:\s*\x60([^\x60]*)\x60/g)].map((match) => match[1]);
        expect(backQuoted.every((value) => value.includes("$msg("))).toBe(true);
    });
});
