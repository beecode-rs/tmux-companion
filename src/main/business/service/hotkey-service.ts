import { type BrowserWindow, globalShortcut } from 'electron'

import { type SettingsRepo } from '#src/main/business/repo/settings-repo'

// Wayland requires the GlobalShortcuts portal for global shortcuts to work;
// implementing portal integration is out of scope for this app.
export class HotkeyService {
  protected readonly _ensureMainWindow: () => BrowserWindow

  protected readonly _settingsRepo: SettingsRepo

  protected readonly _toMainWindow: () => BrowserWindow | null

  protected _registeredAccelerator: string | null = null

  protected _unsubscribeSettingsChange: (() => void) | null = null

  constructor(params: {
    ensureMainWindow: () => BrowserWindow
    settingsRepo: SettingsRepo
    toMainWindow: () => BrowserWindow | null
  }) {
    this._ensureMainWindow = params.ensureMainWindow
    this._settingsRepo = params.settingsRepo
    this._toMainWindow = params.toMainWindow
  }

  start(): void {
    this._unsubscribeSettingsChange = this._settingsRepo.onSettingsChange({
      callback: () => {
        this.syncRegistration()
      },
    })

    this.syncRegistration()
  }

  stop(): void {
    if (this._unsubscribeSettingsChange !== null) {
      this._unsubscribeSettingsChange()
      this._unsubscribeSettingsChange = null
    }

    this._unregister()
  }

  syncRegistration(): void {
    const settings = this._settingsRepo.getSettings()

    this._unregister()

    if (!settings.hotkeyEnabled) {
      return
    }

    try {
      globalShortcut.register(settings.hotkeyAccelerator, () => {
        this.toggleWindow()
      })

      this._registeredAccelerator = settings.hotkeyAccelerator
    } catch {
      return
    }
  }

  toggleWindow(): void {
    const mainWindow = this._toMainWindow()

    if (mainWindow === null) {
      this._ensureMainWindow()

      return
    }

    if (mainWindow.isVisible()) {
      mainWindow.hide()

      return
    }

    mainWindow.show()
    mainWindow.focus()
  }

  protected _unregister(): void {
    if (this._registeredAccelerator === null) {
      return
    }

    if (globalShortcut.isRegistered(this._registeredAccelerator)) {
      globalShortcut.unregister(this._registeredAccelerator)
    }

    this._registeredAccelerator = null
  }
}
