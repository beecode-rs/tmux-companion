/// <reference types="vite/client" />

export {}

declare global {
  interface Window {
    tmuxCompanion: {
      electronVersion: string
      getVersion: () => Promise<string>
      openExternal: (url: string) => Promise<void>
      onSelectionChanged: (callback: (instanceId: string) => void) => () => void
      onSessionsChanged: (callback: (instanceId: string) => void) => () => void
      selectedInstanceId: string | null
      serverPort: number
      serverToken: string
      setSelectedInstance: (instanceId: string) => void
    }
  }
}
