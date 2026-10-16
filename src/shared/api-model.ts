import { type IInstance, type IInstanceSshConfig } from '#src/shared/instance-model'
import { type ISessionInfo } from '#src/shared/session-model'

export interface ITerminalInfo {
  id: string
  name: string
  path: string
}

export interface ITerminalListResult {
  default: string
  detected: ITerminalInfo[]
  isSelectedTerminalMissing: boolean
  selected: string | null
}

export interface IApiErrorBody {
  message: string
}

export interface ITerminalSettingRequest {
  id: string
}

export interface ITerminalSettingResponse {
  selected: string
}

export interface IListInstancesResponse {
  instances: IInstance[]
}

export interface ICreateInstanceRequest {
  label: string
  ssh: IInstanceSshConfig
}

export interface IInstanceResponse {
  instance: IInstance
}

export interface IUpdateInstanceRequest {
  label?: string
  ssh?: IInstanceSshConfig
}

export interface ITestConnectionRequest {
  ssh: IInstanceSshConfig
}

export interface ITestConnectionResponse {
  message: string
}

export interface IUpdateSettingsRequest {
  confirmBeforeKill?: boolean
  ghosttyThemeImport?: boolean
  hotkeyAccelerator?: string
  hotkeyEnabled?: boolean
  launchTemplates?: Record<string, string>
}

export type SessionEventsMode = 'control' | 'poll'

export interface IListSessionsResponse {
  events: SessionEventsMode
  sessions: ISessionInfo[]
}

export interface ICreateSessionRequest {
  name?: string
}

export interface ICloneSessionRequest {
  name: string
}

export interface ISessionNameResponse {
  name: string
}

export interface IRenameSessionRequest {
  name: string
}

export interface ISwitchSessionResponse {
  lastSession: string
}

export interface IThemeColors {
  background?: string
  cursor?: string
  foreground?: string
  selectionBackground?: string
  selectionForeground?: string
}

export interface IGetThemeResponse {
  fontFamily?: string
  fontSize?: number
  theme?: IThemeColors
}

export interface IUpdateAsset {
  name: string
  size: number
  url: string
}

export interface IUpdateCheckResponse {
  asset: IUpdateAsset | null
  currentVersion: string
  isUpdateAvailable: boolean
  latestVersion: string
  releaseUrl: string
}

export type UpdateCheckErrorKind =
  'http-error' | 'invalid-response' | 'network' | 'rate-limited' | 'timeout' | 'unknown'

export interface IUpdateCheckFailure {
  httpStatusCode: number | null
  kind: UpdateCheckErrorKind
  message: string
  rateLimitResetEpochMs: number | null
}

export type IUpdateCheckResult =
  { failure: IUpdateCheckFailure; status: 'failed' } | { status: 'ok'; updateCheck: IUpdateCheckResponse }

export interface IUpdateDownloadResponse {
  filePath: string
}

export type UpdateDownloadStatus = 'completed' | 'downloading' | 'error' | 'idle'

export type UpdateFlowState = 'downloaded' | 'downloading' | 'idle'

export interface IUpdateDownloadStatusResponse {
  errorMessage?: string
  filePath?: string
  receivedBytes: number
  status: UpdateDownloadStatus
  totalBytes: number
}
