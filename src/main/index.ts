import { BrowserWindow, type IpcMainEvent, app, ipcMain } from 'electron'
import { join } from 'node:path'

import { SettingsRepo } from '#src/main/business/repo/settings-repo'
import { ControlModeService } from '#src/main/business/service/control-mode-service'
import { GhosttyThemeService } from '#src/main/business/service/ghostty-theme-service'
import { HotkeyService } from '#src/main/business/service/hotkey-service'
import { InstanceService } from '#src/main/business/service/instance-service'
import { PtyService } from '#src/main/business/service/pty-service'
import { SshConnectionService } from '#src/main/business/service/ssh-connection-service'
import { TerminalDetectService } from '#src/main/business/service/terminal-detect-service'
import { TerminalLaunchService } from '#src/main/business/service/terminal-launch-service'
import { TmuxService } from '#src/main/business/service/tmux-service'
import { TrayService } from '#src/main/business/service/tray-service'
import { PtyWsServer } from '#src/main/server/pty-ws'
import { ApiServer } from '#src/main/server/server'
import { LocaleEnvUtil } from '#src/main/util/locale-env-util'
import { LoginPathUtil } from '#src/main/util/login-path-util'
import { appTitleUtil } from '#src/shared/app-title-util'
import { type IInstance } from '#src/shared/instance-model'

const DEFAULT_WINDOW_HEIGHT = 800

const DEFAULT_WINDOW_WIDTH = 1200

const GET_VERSION_CHANNEL = 'app:getVersion'

const SELECTION_CHANGED_CHANNEL = 'app:selectionChanged'

const SERVER_INFO_CHANNEL = 'app:getServerInfo'

const SESSIONS_CHANGED_CHANNEL = 'app:sessionsChanged'

const SET_SELECTED_INSTANCE_CHANNEL = 'app:setSelectedInstance'

const WINDOW_STATE_SAVE_DEBOUNCE_MS = 500

interface IWindowStateSaver {
  save: () => void
  saveDebounced: () => void
}

const toErrorMessage = (params: { error: unknown }): string => {
  if (params.error instanceof Error) {
    return params.error.message
  }

  return String(params.error)
}

const broadcastSelectionChanged = (params: { instanceId: string }): void => {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(SELECTION_CHANGED_CHANNEL, params.instanceId)
  })
}

const ensureMainWindow = (params: { settingsRepo: SettingsRepo }): BrowserWindow => {
  const existingWindow = BrowserWindow.getAllWindows()[0]

  if (existingWindow !== undefined) {
    app.focus({ steal: true })
    existingWindow.show()
    existingWindow.focus()

    return existingWindow
  }

  return createMainWindow({ settingsRepo: params.settingsRepo })
}

const logError = (params: { context: string; error: unknown }): void => {
  // eslint-disable-next-line no-console
  console.error(`tmux-companion ${params.context}: ${toErrorMessage({ error: params.error })}`)
}

const toSelectedInstanceHandler = (params: { settingsRepo: SettingsRepo }) => {
  return (_event: IpcMainEvent, instanceId: unknown): void => {
    if (typeof instanceId !== 'string') {
      return
    }

    const windowState = params.settingsRepo.getWindowState()

    params.settingsRepo.saveWindowState({
      windowState: { ...windowState, selectedInstanceId: instanceId },
    })
  }
}

const toWindowStateSaver = (params: { mainWindow: BrowserWindow; settingsRepo: SettingsRepo }): IWindowStateSaver => {
  const debounceState = { timeoutId: null as ReturnType<typeof setTimeout> | null }

  const save = (): void => {
    params.settingsRepo.saveWindowState({
      windowState: {
        bounds: params.mainWindow.getBounds(),
        selectedInstanceId: params.settingsRepo.getWindowState().selectedInstanceId,
      },
    })
  }

  return {
    save,
    saveDebounced: () => {
      if (debounceState.timeoutId !== null) {
        clearTimeout(debounceState.timeoutId)
      }

      debounceState.timeoutId = setTimeout(() => {
        debounceState.timeoutId = null
        save()
      }, WINDOW_STATE_SAVE_DEBOUNCE_MS)
    },
  }
}

const toWindowIconPath = (): string | undefined => {
  if (process.platform !== 'linux') {
    return undefined
  }

  return join(__dirname, '../../build/icons/512x512.png')
}

const toAppTitle = (): string => {
  return appTitleUtil.resolve({ isDev: process.env.ELECTRON_RENDERER_URL !== undefined })
}

const createMainWindow = (params: { settingsRepo: SettingsRepo }): BrowserWindow => {
  const bounds = params.settingsRepo.getWindowState().bounds
  const mainWindow = new BrowserWindow({
    height: bounds?.height ?? DEFAULT_WINDOW_HEIGHT,
    icon: toWindowIconPath(),
    show: false,
    title: toAppTitle(),
    webPreferences: {
      contextIsolation: true,
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
    },
    width: bounds?.width ?? DEFAULT_WINDOW_WIDTH,
    x: bounds?.x,
    y: bounds?.y,
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  const windowStateSaver = toWindowStateSaver({ mainWindow, settingsRepo: params.settingsRepo })

  mainWindow.on('close', () => {
    windowStateSaver.save()
  })

  mainWindow.on('move', () => {
    windowStateSaver.saveDebounced()
  })

  mainWindow.on('resize', () => {
    windowStateSaver.saveDebounced()
  })

  if (process.env.ELECTRON_RENDERER_URL !== undefined) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

const startInitialPty = (params: {
  instances: IInstance[]
  ptyService: PtyService
  selectedInstanceId: string | null
}): void => {
  const selectedInstance = params.instances.find((instance) => {
    return instance.id === params.selectedInstanceId
  })

  const instance = selectedInstance ?? params.instances[0]

  if (instance === undefined) {
    return
  }

  void params.ptyService.getOrCreate({ instanceId: instance.id, mode: 'tmux' }).catch((error: unknown) => {
    logError({ context: `pty start failed for instance '${instance.label}'`, error })
  })
}

const bootstrapApp = async (): Promise<void> => {
  new LocaleEnvUtil().applyToProcessEnv()
  await new LoginPathUtil().applyToProcessEnv()

  const settingsRepo = new SettingsRepo()
  const tmuxService = new TmuxService()
  const controlModeService = new ControlModeService({ settingsRepo, tmuxService })
  const ghosttyThemeService = new GhosttyThemeService({ settingsRepo })
  const instanceService = new InstanceService({ settingsRepo, tmuxService })
  const sshConnectionService = new SshConnectionService()
  const terminalDetectService = new TerminalDetectService({ settingsRepo })
  const terminalLaunchService = new TerminalLaunchService({ settingsRepo, terminalDetectService })
  const ptyService = new PtyService({ settingsRepo, tmuxService })

  terminalLaunchService.ensureDefaultTemplates()

  const apiServer = new ApiServer({
    controlModeService,
    ghosttyThemeService,
    instanceService,
    ptyService,
    settingsRepo,
    sshConnectionService,
    terminalDetectService,
    terminalLaunchService,
    tmuxService,
  })

  const serverInfo = await apiServer.start()
  const ptyWsServer = new PtyWsServer({ ptyService, token: serverInfo.token })

  ptyWsServer.attach({ httpServer: serverInfo.httpServer })

  const windowState = settingsRepo.getWindowState()

  ipcMain.on(SERVER_INFO_CHANNEL, (event) => {
    event.returnValue = {
      selectedInstanceId: windowState.selectedInstanceId,
      serverPort: serverInfo.port,
      serverToken: serverInfo.token,
    }
  })

  ipcMain.on(SET_SELECTED_INSTANCE_CHANNEL, toSelectedInstanceHandler({ settingsRepo }))

  ipcMain.handle(GET_VERSION_CHANNEL, () => {
    return app.getVersion()
  })

  // eslint-disable-next-line no-console
  console.info(`tmux-companion api listening on 127.0.0.1:${String(serverInfo.port)} token=${serverInfo.token}`)

  createMainWindow({ settingsRepo })

  startInitialPty({
    instances: settingsRepo.getInstances(),
    ptyService,
    selectedInstanceId: windowState.selectedInstanceId,
  })

  controlModeService.onRefresh({
    callback: (instanceId: string) => {
      BrowserWindow.getAllWindows().forEach((window) => {
        window.webContents.send(SESSIONS_CHANGED_CHANNEL, instanceId)
      })
    },
  })

  settingsRepo.getInstances().forEach((instance) => {
    controlModeService.start({ instanceId: instance.id })
  })

  const trayService = new TrayService({
    appTitle: toAppTitle(),
    controlModeService,
    onActivateSession: (params: { instanceId: string }) => {
      const windowState = settingsRepo.getWindowState()

      settingsRepo.saveWindowState({
        windowState: { ...windowState, selectedInstanceId: params.instanceId },
      })
      broadcastSelectionChanged({ instanceId: params.instanceId })
      ensureMainWindow({ settingsRepo })
    },
    onSessionSwitched: (params: { instanceId: string }) => {
      BrowserWindow.getAllWindows().forEach((window) => {
        window.webContents.send(SESSIONS_CHANGED_CHANNEL, params.instanceId)
      })
    },
    ptyService,
    settingsRepo,
    tmuxService,
  })

  const hotkeyService = new HotkeyService({
    ensureMainWindow: () => {
      return ensureMainWindow({ settingsRepo })
    },
    settingsRepo,
    toMainWindow: () => {
      return BrowserWindow.getAllWindows()[0] ?? null
    },
  })

  trayService.start()
  hotkeyService.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow({ settingsRepo })
    }
  })

  app.on('will-quit', () => {
    trayService.stop()
    hotkeyService.stop()
    controlModeService.stopAll()
    ptyService.destroyAll()
    ptyWsServer.stop()
    void apiServer.stop()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

void app
  .whenReady()
  .then(bootstrapApp)
  .catch((error: unknown) => {
    logError({ context: 'bootstrap failed', error })
  })
