export interface IAppSettings {
  confirmBeforeKill: boolean
  ghosttyThemeImport: boolean
  hotkeyAccelerator: string
  hotkeyEnabled: boolean
  launchTemplates: Record<string, string>
  selectedTerminal: string | null
}

export interface IWindowState {
  bounds?: IWindowStateBounds
  selectedInstanceId: string | null
}

export interface IWindowStateBounds {
  height: number
  width: number
  x: number
  y: number
}
