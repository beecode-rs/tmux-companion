import Store from 'electron-store'

import { type IInstance } from '#src/shared/instance-model'
import { type IAppSettings, type IWindowState } from '#src/shared/settings-model'

interface ISettingsStoreContent {
  instances: IInstance[]
  settings: IAppSettings
  windowState: IWindowState
}

export class SettingsRepo {
  protected readonly _defaultSettings: IAppSettings = {
    confirmBeforeKill: false,
    ghosttyThemeImport: false,
    hotkeyAccelerator: 'CommandOrControl+Alt+T',
    hotkeyEnabled: true,
    launchTemplates: {},
    selectedTerminal: null,
  }

  protected readonly _store: Store<ISettingsStoreContent>

  constructor() {
    this._store = new Store<ISettingsStoreContent>({
      defaults: {
        instances: [],
        settings: this._defaultSettings,
        windowState: { selectedInstanceId: null },
      },
      name: 'tmux-companion-settings',
    })
    this._ensureLocalInstance()
  }

  getInstances(): IInstance[] {
    return [...this._store.get('instances')]
  }

  getSettings(): IAppSettings {
    return { ...this._defaultSettings, ...this._store.get('settings') }
  }

  onSettingsChange(params: { callback: (settings: IAppSettings) => void }): () => void {
    return this._store.onDidChange('settings', (newValue) => {
      if (newValue === undefined) {
        return
      }

      params.callback({ ...this._defaultSettings, ...newValue })
    })
  }

  getWindowState(): IWindowState {
    const storedWindowState = this._store.get('windowState')
    const selectedInstanceId = this._resolveSelectedInstanceId({ storedValue: storedWindowState.selectedInstanceId })

    return { ...storedWindowState, selectedInstanceId }
  }

  saveInstances(params: { instances: IInstance[] }): void {
    this._store.set('instances', params.instances)
  }

  saveSettings(params: { settings: IAppSettings }): void {
    this._store.set('settings', params.settings)
  }

  saveWindowState(params: { windowState: IWindowState }): void {
    this._store.set('windowState', params.windowState)
  }

  setLastSession(params: { fullSessionName: string; instanceId: string }): void {
    const instances = this.getInstances().map((instance) => {
      if (instance.id !== params.instanceId) {
        return instance
      }

      return { ...instance, lastSession: params.fullSessionName }
    })

    this.saveInstances({ instances })
  }

  protected _ensureLocalInstance(): void {
    const instances = this._store.get('instances')
    const hasLocalInstance = instances.some((instance) => {
      return instance.type === 'local'
    })

    if (hasLocalInstance) {
      return
    }

    this._store.set('instances', [{ id: 'local', label: 'Local', type: 'local' }, ...instances])
  }

  protected _resolveSelectedInstanceId(params: { storedValue?: string | null }): string | null {
    if (params.storedValue === undefined || params.storedValue === null) {
      return null
    }

    const isSelectedInstanceKnown = this.getInstances().some((instance) => {
      return instance.id === params.storedValue
    })

    if (isSelectedInstanceKnown) {
      return params.storedValue
    }

    return null
  }
}
