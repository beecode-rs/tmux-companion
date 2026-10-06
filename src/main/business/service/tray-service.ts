import { Menu, type MenuItemConstructorOptions, type NativeImage, Tray, app, nativeImage } from 'electron'

import { type SettingsRepo } from '#src/main/business/repo/settings-repo'
import { type ControlModeService } from '#src/main/business/service/control-mode-service'
import { type PtyService } from '#src/main/business/service/pty-service'
import { type TmuxService } from '#src/main/business/service/tmux-service'
import { type IInstance } from '#src/shared/instance-model'
import { type ISessionInfo } from '#src/shared/session-model'

const ACTIVATE_MAX_ATTEMPTS = 3

const ACTIVATE_RETRY_DELAY_MS = 600

const TRAY_ICON_PNG_16_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHElEQVR4nGNgGHbg/6gh1DeEIgOGmeb/WPBwAQC1rw7yUlwt0AAAAABJRU5ErkJggg=='

const TRAY_ICON_PNG_32_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAQklEQVR4nO3PsQ0AIAzEwOy/dGj4EonOoPikr+NUSTrrvbkBgYfgAYGH4AGBh+ABgYcYgAX4OcbPnz/cl/snQJphAT92O8XjOuTQAAAAAElFTkSuQmCC'

const TRAY_REFRESH_DEBOUNCE_MS = 250

const TRAY_POLL_INTERVAL_MS = 5000

export type ITrayActivateSessionCallback = (params: { instanceId: string }) => void

export type ITraySessionSwitchedCallback = (params: { instanceId: string }) => void

interface ITrayInstanceSessions {
  instance: IInstance
  sessions: ISessionInfo[] | null
}

export class TrayService {
  protected readonly _appTitle: string

  protected readonly _controlModeService: ControlModeService

  protected readonly _onActivateSession: ITrayActivateSessionCallback

  protected readonly _onSessionSwitched: ITraySessionSwitchedCallback

  protected readonly _ptyService: PtyService

  protected readonly _settingsRepo: SettingsRepo

  protected readonly _tmuxService: TmuxService

  protected _isRefreshing = false

  protected _isStopped = true

  protected _pollIntervalId: ReturnType<typeof setInterval> | null = null

  protected _refreshTimeoutId: ReturnType<typeof setTimeout> | null = null

  protected _tray: Tray | null = null

  protected _unsubscribeRefresh: (() => void) | null = null

  constructor(params: {
    appTitle: string
    controlModeService: ControlModeService
    onActivateSession: ITrayActivateSessionCallback
    onSessionSwitched: ITraySessionSwitchedCallback
    ptyService: PtyService
    settingsRepo: SettingsRepo
    tmuxService: TmuxService
  }) {
    this._appTitle = params.appTitle
    this._controlModeService = params.controlModeService
    this._onActivateSession = params.onActivateSession
    this._onSessionSwitched = params.onSessionSwitched
    this._ptyService = params.ptyService
    this._settingsRepo = params.settingsRepo
    this._tmuxService = params.tmuxService
  }

  start(): void {
    if (!this._isStopped) {
      return
    }

    this._isStopped = false

    const tray = new Tray(this._toTrayImage())

    tray.setToolTip(this._appTitle)
    tray.setContextMenu(Menu.buildFromTemplate([]))
    this._tray = tray

    this._unsubscribeRefresh = this._controlModeService.onRefresh({
      callback: () => {
        this._scheduleRefresh()
      },
    })

    this._pollIntervalId = setInterval(() => {
      this._scheduleRefresh()
    }, TRAY_POLL_INTERVAL_MS)

    void this._refresh()
  }

  stop(): void {
    if (this._isStopped) {
      return
    }

    this._isStopped = true

    if (this._pollIntervalId !== null) {
      clearInterval(this._pollIntervalId)
      this._pollIntervalId = null
    }

    if (this._refreshTimeoutId !== null) {
      clearTimeout(this._refreshTimeoutId)
      this._refreshTimeoutId = null
    }

    if (this._unsubscribeRefresh !== null) {
      this._unsubscribeRefresh()
      this._unsubscribeRefresh = null
    }

    if (this._tray !== null) {
      this._tray.destroy()
      this._tray = null
    }
  }

  async listMenuLabelsForSmoke(): Promise<string[]> {
    const instanceSessions = await Promise.all(
      this._settingsRepo.getInstances().map(async (instance) => {
        return await this._toInstanceSessions({ instance })
      }),
    )

    return instanceSessions.reduce<string[]>(
      (labels, entry) => {
        return [
          ...labels,
          entry.instance.label,
          ...(entry.sessions?.map((session) => {
            return session.name
          }) ?? ['No sessions']),
          'New Session',
        ]
      },
      ['Quit'],
    )
  }

  async activateSession(params: { instanceId: string; name: string }): Promise<void> {
    try {
      await this._handleActivateSession({ instanceId: params.instanceId, name: params.name })
    } catch {
      return
    }
  }

  protected async _handleActivateSession(params: { instanceId: string; name: string }): Promise<void> {
    const instance = this._toInstance({ instanceId: params.instanceId })

    this._onActivateSession({ instanceId: params.instanceId })

    const isSwitched = await this._toSwitchedResult({
      attempt: 1,
      instance,
      name: params.name,
    })

    if (isSwitched) {
      this._settingsRepo.setLastSession({ fullSessionName: params.name, instanceId: params.instanceId })
    }

    this._onSessionSwitched({ instanceId: params.instanceId })
    this._scheduleRefresh()
  }

  protected async _handleCreateSession(params: { instance: IInstance }): Promise<void> {
    try {
      await this._tmuxService.createSession({ instance: params.instance })
    } catch {
      return
    } finally {
      this._scheduleRefresh()
    }
  }

  protected async _refresh(): Promise<void> {
    const tray = this._toLiveTray()

    if (tray === null) {
      return
    }

    this._isRefreshing = true

    try {
      const instanceSessions = await Promise.all(
        this._settingsRepo.getInstances().map(async (instance) => {
          return await this._toInstanceSessions({ instance })
        }),
      )

      if (this._isStopped) {
        return
      }

      tray.setContextMenu(Menu.buildFromTemplate(this._toMenuTemplate({ instanceSessions })))
    } catch {
      return
    } finally {
      this._isRefreshing = false
    }
  }

  protected _scheduleRefresh(): void {
    if (this._isStopped || this._refreshTimeoutId !== null) {
      return
    }

    this._refreshTimeoutId = setTimeout(() => {
      this._refreshTimeoutId = null
      void this._refresh()
    }, TRAY_REFRESH_DEBOUNCE_MS)
  }

  protected _toInstanceMenuItem(params: { instanceSessions: ITrayInstanceSessions }): MenuItemConstructorOptions {
    return {
      label: params.instanceSessions.instance.label,
      submenu: [
        ...this._toSessionMenuItems({ instanceSessions: params.instanceSessions }),
        { type: 'separator' },
        {
          click: () => {
            void this._handleCreateSession({ instance: params.instanceSessions.instance })
          },
          label: 'New Session',
        },
      ],
    }
  }

  protected _toLiveTray(): Tray | null {
    if (this._isStopped || this._isRefreshing || this._tray === null) {
      return null
    }

    return this._tray
  }

  protected async _toInstanceSessions(params: { instance: IInstance }): Promise<ITrayInstanceSessions> {
    try {
      return {
        instance: params.instance,
        sessions: await this._tmuxService.listSessions({ instance: params.instance }),
      }
    } catch {
      return { instance: params.instance, sessions: null }
    }
  }

  protected _toMenuTemplate(params: { instanceSessions: ITrayInstanceSessions[] }): MenuItemConstructorOptions[] {
    return [
      ...params.instanceSessions.map((entry) => {
        return this._toInstanceMenuItem({ instanceSessions: entry })
      }),
      { type: 'separator' },
      {
        click: () => {
          app.quit()
        },
        label: 'Quit',
      },
    ]
  }

  protected _toSessionMenuItems(params: { instanceSessions: ITrayInstanceSessions }): MenuItemConstructorOptions[] {
    if (params.instanceSessions.sessions === null) {
      return [{ enabled: false, label: 'Sessions unavailable' }]
    }

    if (params.instanceSessions.sessions.length === 0) {
      return [{ enabled: false, label: 'No sessions' }]
    }

    return params.instanceSessions.sessions.map((session) => {
      return {
        click: () => {
          void this.activateSession({ instanceId: params.instanceSessions.instance.id, name: session.name })
        },
        label: session.name,
      }
    })
  }

  protected async _toSwitchedResult(params: { attempt: number; instance: IInstance; name: string }): Promise<boolean> {
    if (params.attempt > ACTIVATE_MAX_ATTEMPTS) {
      return false
    }

    try {
      await this._ptyService.getOrCreate({ instanceId: params.instance.id, mode: 'tmux' })
      await this._ptyService.switchAttachedClient({ instance: params.instance, name: params.name })

      return true
    } catch {
      await this._delay({ durationMs: ACTIVATE_RETRY_DELAY_MS })

      return await this._toSwitchedResult({ attempt: params.attempt + 1, instance: params.instance, name: params.name })
    }
  }

  protected _toInstance(params: { instanceId: string }): IInstance {
    const knownInstance = this._settingsRepo.getInstances().find((instance) => {
      return instance.id === params.instanceId
    })

    if (knownInstance === undefined) {
      throw new Error(`Unknown instance '${params.instanceId}'`)
    }

    return knownInstance
  }

  protected _toTrayImage(): NativeImage {
    const image = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_PNG_16_BASE64, 'base64'))

    image.addRepresentation({ buffer: Buffer.from(TRAY_ICON_PNG_32_BASE64, 'base64'), scaleFactor: 2 })
    image.setTemplateImage(true)

    return image
  }

  protected _delay(params: { durationMs: number }): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, params.durationMs)
    })
  }
}
