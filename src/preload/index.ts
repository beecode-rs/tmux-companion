import { type IpcRendererEvent, contextBridge, ipcRenderer, shell } from 'electron'

const GET_VERSION_CHANNEL = 'app:getVersion'

const SELECTED_INSTANCE_CHANNEL = 'app:setSelectedInstance'

const SELECTION_CHANGED_CHANNEL = 'app:selectionChanged'

const SERVER_INFO_CHANNEL = 'app:getServerInfo'

const SESSIONS_CHANGED_CHANNEL = 'app:sessionsChanged'

const serverInfo = ipcRenderer.sendSync(SERVER_INFO_CHANNEL) as
  | {
      selectedInstanceId: string | null
      serverPort: number
      serverToken: string
    }
  | undefined

contextBridge.exposeInMainWorld('tmuxCompanion', {
  electronVersion: process.versions.electron,
  getVersion: (): Promise<string> => {
    return ipcRenderer.invoke(GET_VERSION_CHANNEL)
  },
  onSelectionChanged: (callback: (instanceId: string) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, instanceId: unknown): void => {
      if (typeof instanceId !== 'string') {
        return
      }

      callback(instanceId)
    }

    ipcRenderer.on(SELECTION_CHANGED_CHANNEL, listener)

    return () => {
      ipcRenderer.removeListener(SELECTION_CHANGED_CHANNEL, listener)
    }
  },
  onSessionsChanged: (callback: (instanceId: string) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, instanceId: unknown): void => {
      if (typeof instanceId !== 'string') {
        return
      }

      callback(instanceId)
    }

    ipcRenderer.on(SESSIONS_CHANGED_CHANNEL, listener)

    return () => {
      ipcRenderer.removeListener(SESSIONS_CHANGED_CHANNEL, listener)
    }
  },
  openExternal: (url: string): Promise<void> => {
    return shell.openExternal(url)
  },
  selectedInstanceId: serverInfo?.selectedInstanceId ?? null,
  serverPort: serverInfo?.serverPort ?? 0,
  serverToken: serverInfo?.serverToken ?? '',
  setSelectedInstance: (instanceId: string): void => {
    ipcRenderer.send(SELECTED_INSTANCE_CHANNEL, instanceId)
  },
})
