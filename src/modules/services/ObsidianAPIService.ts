import { InjectableAPIService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableAPIService";
import type { ObsidianServiceContext } from "@/modules/services/ObsidianServiceContext";
import { Platform, type Command, type ViewCreator, type WorkspaceLeaf } from "@/deps.ts";
import { ObsHttpHandler } from "@/modules/essentialObsidian/APILib/ObsHttpHandler";
import { ObsidianConfirm } from "./ObsidianConfirm";
import type { Confirm } from "@vrtmrz/livesync-commonlib/compat/interfaces/Confirm";
import { requestUrl, type RequestUrlParam } from "@/deps";
import { compatGlobal } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";
// All Services will be migrated to be based on Plain Services, not Injectable Services.
// This is a migration step.

declare module "obsidian" {
    interface App {
        appId?: string;
        isMobile?: boolean;
    }
}

export class ObsidianAPIService extends InjectableAPIService<ObsidianServiceContext> {
    _customHandler: ObsHttpHandler | undefined;
    _confirmInstance: Confirm;
    private readonly _windowOpenInFlight = new Map<string, Promise<void>>();
    constructor(context: ObsidianServiceContext) {
        super(context);
        this._confirmInstance = new ObsidianConfirm(context);
    }
    getCustomFetchHandler(): ObsHttpHandler {
        if (!this._customHandler) this._customHandler = new ObsHttpHandler(undefined, undefined);
        return this._customHandler;
    }

    async showWindow(viewType: string): Promise<void> {
        const inFlight = this._windowOpenInFlight.get(viewType);
        if (inFlight) return inFlight;

        const operation = this._activateWindow(viewType);
        this._windowOpenInFlight.set(viewType, operation);
        try {
            await operation;
        } finally {
            if (this._windowOpenInFlight.get(viewType) === operation) {
                this._windowOpenInFlight.delete(viewType);
            }
        }
    }

    private async _activateWindow(viewType: string): Promise<void> {
        const leaves = this.app.workspace.getLeavesOfType(viewType);
        // A previous release could have put Agent in the mobile drawer/right
        // sidebar. Reusing that leaf preserves the broken host layout, so
        // prefer a leaf found by iterateRootLeaves (the main workspace root).
        let mainLeaf: WorkspaceLeaf | undefined;
        const iterateRootLeaves = (this.app.workspace as unknown as {
            iterateRootLeaves?: (callback: (leaf: WorkspaceLeaf) => unknown) => void;
        }).iterateRootLeaves;
        if (typeof iterateRootLeaves === "function") {
            iterateRootLeaves.call(this.app.workspace, (leaf) => {
                if (!mainLeaf && leaf.getViewState().type === viewType) mainLeaf = leaf;
            });
        } else if (leaves.length > 0) {
            // Test doubles and older hosts without iterateRootLeaves retain
            // the historical reuse behaviour.
            mainLeaf = leaves[0];
        }

        if (mainLeaf) {
            await mainLeaf.setViewState({
                type: viewType,
                active: true,
            });
            await this.app.workspace.revealLeaf(mainLeaf);
            return;
        }

        // `"tab"` explicitly creates a leaf in the preferred root location;
        // this is different from the old boolean overload which may choose a
        // hidden mobile drawer/sidebar.
        const leaf = this.app.workspace.getLeaf("tab");
        await leaf.setViewState({
            type: viewType,
            active: true,
        });
        await this.app.workspace.revealLeaf(leaf);

        // Remove stale side leaves only after the new page is visible, so a
        // cleanup failure cannot leave the user with a blank Agent page.
        for (const stale of leaves) {
            if (stale === leaf) continue;
            try {
                stale.detach();
            } catch {
                // Obsidian may already have removed a deferred mobile leaf.
            }
        }
    }

    override async showWindowOnRight(viewType: string): Promise<void> {
        const existing = this.app.workspace.getLeavesOfType(viewType);
        if (existing.length > 0) {
            await this.app.workspace.revealLeaf(existing[0]);
            return;
        }
        const rightLeaf = this.app.workspace.getRightLeaf(false);
        if (rightLeaf) {
            await rightLeaf.setViewState({
                type: viewType,
                active: false,
            });
            await this.app.workspace.revealLeaf(rightLeaf);
            return;
        }

        await this.showWindow(viewType);
    }

    private get app() {
        return this.context.app;
    }

    override getPlatform(): string {
        if (Platform.isAndroidApp) {
            return "android-app";
        } else if (Platform.isIosApp) {
            return "ios";
        } else if (Platform.isMacOS) {
            return "macos";
        } else if (Platform.isMobileApp) {
            return "mobile-app";
        } else if (Platform.isMobile) {
            return "mobile";
        } else if (Platform.isSafari) {
            return "safari";
        } else if (Platform.isDesktop) {
            return "desktop";
        } else if (Platform.isDesktopApp) {
            return "desktop-app";
        } else {
            return "unknown-obsidian";
        }
    }
    override isMobile(): boolean {
        return "isMobile" in this.app ? !!this.app.isMobile : false;
    }
    override getAppID(): string {
        return `${"appId" in this.app ? this.app.appId : ""}`;
    }

    override getSystemVaultName(): string {
        return this.app.vault.getName();
    }

    override getAppVersion(): string {
        const navigatorString = compatGlobal.navigator?.userAgent ?? "";
        const match = navigatorString.match(/obsidian\/([0-9]+\.[0-9]+\.[0-9]+)/);
        if (match && match.length >= 2) {
            return match[1];
        }
        return "0.0.0";
    }

    override getPluginVersion(): string {
        return this.context.plugin.manifest.version;
    }

    get confirm(): Confirm {
        return this._confirmInstance;
    }

    addCommand<TCommand extends Command>(command: TCommand): TCommand {
        return this.context.plugin.addCommand(command) as TCommand;
    }

    registerWindow<T>(type: string, factory: (leaf: T) => unknown): void {
        return this.context.plugin.registerView(type, factory as ViewCreator);
    }

    addRibbonIcon(icon: string, title: string, callback: (evt: MouseEvent) => unknown): HTMLElement {
        return this.context.plugin.addRibbonIcon(icon, title, callback);
    }

    registerProtocolHandler(action: string, handler: (params: Record<string, string>) => unknown): void {
        return this.context.plugin.registerObsidianProtocolHandler(action, handler);
    }

    /**
     * In Obsidian, we will use the native `requestUrl` function as the default fetch handler,
     * to address unavoidable CORS issues.
     */
    override async nativeFetch(req: string | Request, opts?: RequestInit): Promise<Response> {
        const url = typeof req === "string" ? req : req.url;
        let body: string | ArrayBuffer | undefined = undefined;
        const method =
            typeof opts?.method === "string"
                ? opts.method
                : req instanceof Request && typeof req.method === "string"
                  ? req.method
                  : "GET";
        if (typeof req !== "string") {
            if (opts?.body) {
                body = typeof opts.body === "string" ? opts.body : await new Response(opts.body).arrayBuffer();
            } else if (req.body) {
                body = await new Response(req.body).arrayBuffer();
            }
        } else {
            body = opts?.body as string;
        }
        const reqHeaders = new Headers(req instanceof Request ? req.headers : {});

        const optHeaders = {} as Record<string, string>;
        // Merge headers from the Request object and the options, with options taking precedence
        reqHeaders.forEach((value, key) => {
            optHeaders[key] = value;
        });
        if (opts && "headers" in opts) {
            if (opts.headers instanceof Headers) {
                // For Compatibility, mostly headers.entries() is supported, but not all environments.
                opts.headers.forEach((value, key) => {
                    optHeaders[key] = value;
                });
            } else {
                for (const [key, value] of Object.entries(opts.headers as Record<string, string>)) {
                    optHeaders[key] = value;
                }
            }
        }
        const transformedHeaders = { ...optHeaders };
        // Delete headers that should not be sent by native fetch,
        // they are controlled by the browser and may cause CORS preflight failure if sent manually.
        delete transformedHeaders["host"];
        delete transformedHeaders["Host"];
        delete transformedHeaders["content-length"];
        delete transformedHeaders["Content-Length"];
        const contentType =
            transformedHeaders["content-type"] ?? transformedHeaders["Content-Type"] ?? "application/json";
        const requestParam: RequestUrlParam = {
            url,
            method: method,
            body: body,
            headers: transformedHeaders,
            contentType: contentType,
        };
        const r = await requestUrl({ ...requestParam, throw: false });
        return new Response(r.arrayBuffer, {
            headers: r.headers,
            status: r.status,
            statusText: `${r.status}`,
        });
    }

    override addStatusBarItem(): HTMLElement | undefined {
        return this.context.plugin.addStatusBarItem();
    }

    override setInterval(handler: () => void, timeout: number): number {
        const timerId = compatGlobal.setInterval(handler, timeout);
        this.context.plugin.registerInterval(timerId);
        return timerId;
    }

    override getSystemConfigDir() {
        return this.app.vault.configDir;
    }
}
