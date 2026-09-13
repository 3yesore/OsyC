import { describe, expect, it, vi } from "vitest";
import { syncMarkdownThemeScope, type MarkdownThemeWorkspace } from "./themeScope";

describe("OsyC Markdown theme scope", () => {
    it("adds the OsyC scope only to Markdown leaves", () => {
        const toggle = vi.fn();
        const workspace = {
            getLeavesOfType: vi.fn((type: string) => type === "markdown"
                ? [{ view: { containerEl: { classList: { toggle } } } }]
                : []),
        };
        syncMarkdownThemeScope(workspace as unknown as MarkdownThemeWorkspace, true);
        expect(workspace.getLeavesOfType).toHaveBeenCalledWith("markdown");
        expect(toggle).toHaveBeenCalledWith("osyc-theme-notes", true);
    });

    it("removes the scope when note styling is disabled", () => {
        const toggle = vi.fn();
        syncMarkdownThemeScope({ getLeavesOfType: () => [{ view: { containerEl: { classList: { toggle } } } }] } as unknown as MarkdownThemeWorkspace, false);
        expect(toggle).toHaveBeenCalledWith("osyc-theme-notes", false);
    });

    it("applies the scope to view content roots and nested rendered roots", () => {
        const toggled: string[] = [];
        const workspace = {
            getLeavesOfType: () => [{
                view: {
                    containerEl: {
                        classList: { toggle: (name: string, force?: boolean) => toggled.push(`${name}:${force}`) },
                        querySelectorAll: () => [{ classList: { toggle: (name: string, force?: boolean) => toggled.push(`${name}:${force}`) } }],
                    },
                },
            }],
        } as unknown as MarkdownThemeWorkspace;
        syncMarkdownThemeScope(workspace, true);
        expect(toggled.filter((value) => value === "osyc-theme-notes:true").length).toBeGreaterThan(1);
    });
});
