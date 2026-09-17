import { ObsidianLiveSyncSettingTab } from "./SettingDialogue/ObsidianLiveSyncSettingTab.ts";
import { AbstractObsidianModule } from "@/modules/AbstractObsidianModule.ts";
// import { PouchDB } from "../../lib/src/pouchdb/pouchdb-browser";
import { EVENT_REQUEST_OPEN_SETTINGS, eventHub } from "@/common/events.ts";
import type { LiveSyncCore } from "@/main.ts";
import { openOsycSettings } from "@/osyc/features/AIAgent/OsycSettingsModal";

export class ModuleObsidianSettingDialogue extends AbstractObsidianModule {
    settingTab!: ObsidianLiveSyncSettingTab;

    _everyOnloadAfterLoadSettings(): Promise<boolean> {
        this.settingTab = new ObsidianLiveSyncSettingTab(this.app, this.plugin);
        this.settingTab.reloadAllSettings(true);
        this.plugin.addSettingTab(this.settingTab);
        eventHub.onEvent(EVENT_REQUEST_OPEN_SETTINGS, () => this.openSetting());

        return Promise.resolve(true);
    }

    openSetting() {
        openOsycSettings(this.app);
    }

    get appId() {
        return `${"appId" in this.app ? this.app.appId : ""}`;
    }
    override onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.appLifecycle.onSettingLoaded.addHandler(this._everyOnloadAfterLoadSettings.bind(this));
    }
}
