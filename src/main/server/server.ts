import express, { type Express, type NextFunction, type Request, type RequestHandler, type Response } from 'express'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { type Server as HttpServer, createServer } from 'node:http'
import { type AddressInfo } from 'node:net'

import { type SettingsRepo } from '#src/main/business/repo/settings-repo'
import { type ControlModeService } from '#src/main/business/service/control-mode-service'
import { type GhosttyThemeService } from '#src/main/business/service/ghostty-theme-service'
import { type InstanceService } from '#src/main/business/service/instance-service'
import { type PtyService } from '#src/main/business/service/pty-service'
import { type SshConnectionService } from '#src/main/business/service/ssh-connection-service'
import { type TerminalDetectService } from '#src/main/business/service/terminal-detect-service'
import { type TerminalLaunchService } from '#src/main/business/service/terminal-launch-service'
import { tmuxParseUtil } from '#src/main/business/service/tmux-parse-util'
import { type TmuxService } from '#src/main/business/service/tmux-service'
import { type SessionEventsMode } from '#src/shared/api-model'
import { type IInstance, type IInstanceSshConfig } from '#src/shared/instance-model'
import { sessionNamingUtil } from '#src/shared/session-naming-util'
import { type IAppSettings } from '#src/shared/settings-model'

export interface IApiServerInfo {
  httpServer: HttpServer
  port: number
  token: string
}

type RouteHandler = (params: { req: Request; res: Response }) => void | Promise<void>

interface ICloneSessionBody {
  name?: string
}

interface ICreateInstanceBody {
  label?: string
  ssh?: IInstanceSshConfig
}

interface ICreateSessionBody {
  name?: string
}

interface IRenameSessionBody {
  name?: string
}

interface ITerminalSettingBody {
  id?: string
}

interface ITestConnectionBody {
  ssh?: IInstanceSshConfig
}

interface IUpdateInstanceBody {
  label?: string
  ssh?: IInstanceSshConfig
}

interface IUpdateSettingsBody {
  confirmBeforeKill?: unknown
  ghosttyThemeImport?: unknown
  hotkeyAccelerator?: unknown
  hotkeyEnabled?: unknown
  launchTemplates?: unknown
}

const LISTEN_HOST = '127.0.0.1'

const MAX_SESSION_NAME_CODE_POINT = 0x20

const MAX_SESSION_NAME_LENGTH = 64

const TOKEN_BYTES = 24

export class ApiServer {
  protected readonly _app: Express

  protected readonly _httpServer: HttpServer

  protected readonly _controlModeService: ControlModeService

  protected readonly _ghosttyThemeService: GhosttyThemeService

  protected readonly _instanceService: InstanceService

  protected readonly _ptyService: PtyService

  protected readonly _settingsRepo: SettingsRepo

  protected readonly _sshConnectionService: SshConnectionService

  protected readonly _terminalDetectService: TerminalDetectService

  protected readonly _terminalLaunchService: TerminalLaunchService

  protected readonly _tmuxService: TmuxService

  protected readonly _token: string

  constructor(params: {
    controlModeService: ControlModeService
    ghosttyThemeService: GhosttyThemeService
    instanceService: InstanceService
    ptyService: PtyService
    settingsRepo: SettingsRepo
    sshConnectionService: SshConnectionService
    terminalDetectService: TerminalDetectService
    terminalLaunchService: TerminalLaunchService
    tmuxService: TmuxService
  }) {
    this._app = express()
    this._httpServer = createServer(this._app)
    this._controlModeService = params.controlModeService
    this._ghosttyThemeService = params.ghosttyThemeService
    this._instanceService = params.instanceService
    this._ptyService = params.ptyService
    this._settingsRepo = params.settingsRepo
    this._sshConnectionService = params.sshConnectionService
    this._terminalDetectService = params.terminalDetectService
    this._terminalLaunchService = params.terminalLaunchService
    this._tmuxService = params.tmuxService
    this._token = randomBytes(TOKEN_BYTES).toString('hex')
  }

  async start(): Promise<IApiServerInfo> {
    this._registerMiddlewares()
    this._registerRoutes()

    return await new Promise<IApiServerInfo>((resolve) => {
      this._httpServer.listen(0, LISTEN_HOST, () => {
        resolve({
          httpServer: this._httpServer,
          port: this._toPort({ address: this._httpServer.address() }),
          token: this._token,
        })
      })
    })
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      this._httpServer.close(() => {
        resolve()
      })
    })
  }

  protected _assertValidName(params: { name: string }): void {
    const validationError = sessionNamingUtil.validateSessionName(params.name)

    if (validationError !== null) {
      throw new Error(validationError)
    }
  }

  protected _assertValidSessionName(params: { name: string }): void {
    if (
      params.name === '' ||
      params.name.length > MAX_SESSION_NAME_LENGTH ||
      this._hasUnsafeSessionNameChar({ name: params.name })
    ) {
      throw new Error('Invalid session name')
    }
  }

  protected async _handleCloneSession(params: { req: Request; res: Response }): Promise<void> {
    const instance = this._toInstance({ id: this._toRouteParam({ key: 'id', req: params.req }) })
    const sourceName = this._toRouteParam({ key: 'name', req: params.req })
    const body = params.req.body as ICloneSessionBody
    const targetName = body.name ?? ''

    this._assertValidSessionName({ name: sourceName })
    this._assertValidName({ name: targetName })

    const name = await this._tmuxService.cloneSession({ instance, sourceName, targetName })

    params.res.status(201).json({ name })
  }

  protected _handleCreateInstance(params: { req: Request; res: Response }): void {
    const body = params.req.body as ICreateInstanceBody
    const instance = this._instanceService.createInstance({
      label: body.label ?? '',
      ssh: body.ssh,
    })

    this._controlModeService.start({ instanceId: instance.id })
    params.res.status(201).json({ instance })
  }

  protected async _handleCreateSession(params: { req: Request; res: Response }): Promise<void> {
    const instance = this._toInstance({ id: this._toRouteParam({ key: 'id', req: params.req }) })
    const body = params.req.body as ICreateSessionBody

    if (body.name !== undefined && body.name !== '') {
      this._assertValidName({ name: body.name })
    }

    const name = await this._tmuxService.createSession({ instance, name: body.name })

    params.res.status(201).json({ name })
  }

  protected async _handleDeleteInstance(params: { req: Request; res: Response }): Promise<void> {
    const id = this._toRouteParam({ key: 'id', req: params.req })
    const instance = this._toInstance({ id })
    const killSessions = params.req.query['killSessions'] === 'true'

    await this._instanceService.deleteInstance({ id, killSessions })
    this._controlModeService.stop({ instanceId: instance.id })
    this._ptyService.destroy({ instanceId: instance.id })
    params.res.sendStatus(204)
  }

  protected async _handleDeleteSession(params: { req: Request; res: Response }): Promise<void> {
    const instance = this._toInstance({ id: this._toRouteParam({ key: 'id', req: params.req }) })
    const name = this._toRouteParam({ key: 'name', req: params.req })

    this._assertValidSessionName({ name })

    const isActiveSession = await this._isActiveSession({ instance, name })

    if (isActiveSession) {
      const clientTty = await this._ptyService.getOrResolveClientTty({ instanceId: instance.id })

      if (clientTty === null) {
        await this._tmuxService.killSession({ instance, name })
      } else {
        await this._tmuxService.killActiveSession({ clientTty, instance })
      }
    } else {
      await this._tmuxService.killSession({ instance, name })
    }

    params.res.sendStatus(204)
  }

  protected _handleDisconnectInstance(params: { req: Request; res: Response }): void {
    const instance = this._toInstance({ id: this._toRouteParam({ key: 'id', req: params.req }) })

    this._ptyService.destroy({ instanceId: instance.id })
    params.res.sendStatus(204)
  }

  protected _handleGetSettings(params: { req: Request; res: Response }): void {
    params.res.json(this._settingsRepo.getSettings())
  }

  protected _handleGetTheme(params: { req: Request; res: Response }): void {
    const theme = this._ghosttyThemeService.getTheme()

    if (theme === null) {
      params.res.sendStatus(404)

      return
    }

    params.res.json(theme)
  }

  protected _handleListInstances(params: { req: Request; res: Response }): void {
    params.res.json({ instances: this._settingsRepo.getInstances() })
  }

  protected async _handleListSessions(params: { req: Request; res: Response }): Promise<void> {
    const instance = this._toInstance({ id: this._toRouteParam({ key: 'id', req: params.req }) })
    const activeSessionName = await this._toClientSessionName({ instance })
    const sessions = await this._tmuxService.listSessions({ activeSessionName, instance })

    params.res.json({ events: this._toEventsMode({ instanceId: instance.id }), sessions })
  }

  protected async _handleListTerminals(params: { req: Request; res: Response }): Promise<void> {
    const terminals = await this._terminalDetectService.list()

    params.res.json(terminals)
  }

  protected async _handleOpenExternal(params: { req: Request; res: Response }): Promise<void> {
    const instance = this._toInstance({ id: this._toRouteParam({ key: 'id', req: params.req }) })
    const name = this._toRouteParam({ key: 'name', req: params.req })

    this._assertValidSessionName({ name })
    await this._terminalLaunchService.openExternal({ instance, sessionName: name })
    params.res.sendStatus(204)
  }

  protected async _handleRenameSession(params: { req: Request; res: Response }): Promise<void> {
    const instance = this._toInstance({ id: this._toRouteParam({ key: 'id', req: params.req }) })
    const currentName = this._toRouteParam({ key: 'name', req: params.req })
    const body = params.req.body as IRenameSessionBody
    const nextName = body.name ?? ''

    this._assertValidSessionName({ name: currentName })
    this._assertValidName({ name: nextName })

    await this._tmuxService.renameSession({ currentName, instance, nextName })

    params.res.json({ name: nextName })
  }

  protected async _handleSwitchSession(params: { req: Request; res: Response }): Promise<void> {
    const instance = this._toInstance({ id: this._toRouteParam({ key: 'id', req: params.req }) })
    const name = this._toRouteParam({ key: 'name', req: params.req })

    this._assertValidSessionName({ name })

    const clientTty = await this._ptyService.getOrResolveClientTty({ instanceId: instance.id })

    if (clientTty !== null) {
      await this._ptyService.switchAttachedClient({ instance, name })
    }

    this._settingsRepo.setLastSession({ fullSessionName: name, instanceId: instance.id })
    params.res.json({ lastSession: name })
  }

  protected async _handleTestConnection(params: { req: Request; res: Response }): Promise<void> {
    const body = params.req.body as ITestConnectionBody

    if (body.ssh === undefined || body.ssh.host.trim() === '') {
      throw new Error('SSH instances require a host')
    }

    const result = await this._sshConnectionService.testConnection({ ssh: body.ssh })

    params.res.json(result)
  }

  protected _handleUpdateInstance(params: { req: Request; res: Response }): void {
    const body = params.req.body as IUpdateInstanceBody
    const instance = this._instanceService.updateInstance({
      id: this._toRouteParam({ key: 'id', req: params.req }),
      label: body.label,
      ssh: body.ssh,
    })

    params.res.json({ instance })
  }

  protected _handleUpdateTerminalSetting(params: { req: Request; res: Response }): void {
    const body = params.req.body as ITerminalSettingBody

    if (typeof body.id !== 'string' || body.id.trim() === '') {
      throw new Error('Terminal id must be a non-empty string')
    }

    const settings = this._settingsRepo.getSettings()

    this._settingsRepo.saveSettings({ settings: { ...settings, selectedTerminal: body.id } })
    params.res.json({ selected: body.id })
  }

  protected _handleUpdateSettings(params: { req: Request; res: Response }): void {
    const body = params.req.body as IUpdateSettingsBody
    const nextSettings = this._toUpdatedSettings({ current: this._settingsRepo.getSettings(), update: body })

    this._settingsRepo.saveSettings({ settings: nextSettings })
    params.res.json(nextSettings)
  }

  protected async _isActiveSession(params: { instance: IInstance; name: string }): Promise<boolean> {
    const clientSessionName = await this._toClientSessionName({ instance: params.instance })

    return clientSessionName === params.name
  }

  protected async _toClientSessionName(params: { instance: IInstance }): Promise<string | null> {
    const clientTty = await this._ptyService.getOrResolveClientTty({ instanceId: params.instance.id })

    if (clientTty === null) {
      return null
    }

    const clients = await this._tmuxService.listClients({ instance: params.instance })

    return tmuxParseUtil.toClientSessionName({ clientRows: clients, clientTty })
  }

  protected _hasUnsafeSessionNameChar(params: { name: string }): boolean {
    return params.name.split('').some((char) => {
      const codePoint = char.codePointAt(0)

      return codePoint !== undefined && codePoint <= MAX_SESSION_NAME_CODE_POINT
    })
  }

  protected _isAuthorized(params: { authorizationHeader: string | undefined }): boolean {
    const expectedBuffer = Buffer.from(`Bearer ${this._token}`)
    const providedBuffer = Buffer.from(params.authorizationHeader ?? '')

    if (expectedBuffer.length !== providedBuffer.length) {
      return false
    }

    return timingSafeEqual(expectedBuffer, providedBuffer)
  }

  protected _isConflictMessage(params: { message: string }): boolean {
    const conflictPatterns = [
      'No attached tmux client',
      'No tmux client attached',
      'No terminal selected',
      'duplicate session',
    ]

    return conflictPatterns.some((pattern) => {
      return params.message.includes(pattern)
    })
  }

  protected _isValidationMessage(params: { message: string }): boolean {
    const validationPatterns = [
      'Invalid session name',
      'Label cannot be empty',
      'Session name',
      'Session names',
      'Settings field',
      'SSH instances require a host',
      'Terminal id must be',
      'already in use',
      'cannot be changed',
      'cannot be removed',
    ]

    return validationPatterns.some((pattern) => {
      return params.message.includes(pattern)
    })
  }

  protected _registerMiddlewares(): void {
    this._app.use(this._toCorsHandler())
    this._app.use('/api', this._toAuthHandler())
    this._app.use(express.json())
  }

  protected _registerRoutes(): void {
    this._app.get('/api/settings', this._toHandler({ handler: this._handleGetSettings.bind(this) }))
    this._app.get('/api/instances', this._toHandler({ handler: this._handleListInstances.bind(this) }))
    this._app.post('/api/instances', this._toHandler({ handler: this._handleCreateInstance.bind(this) }))
    this._app.patch('/api/instances/:id', this._toHandler({ handler: this._handleUpdateInstance.bind(this) }))
    this._app.delete('/api/instances/:id', this._toHandler({ handler: this._handleDeleteInstance.bind(this) }))
    this._app.post(
      '/api/instances/:id/disconnect',
      this._toHandler({ handler: this._handleDisconnectInstance.bind(this) }),
    )
    this._app.get('/api/instances/:id/sessions', this._toHandler({ handler: this._handleListSessions.bind(this) }))
    this._app.post('/api/instances/:id/sessions', this._toHandler({ handler: this._handleCreateSession.bind(this) }))
    this._app.patch(
      '/api/instances/:id/sessions/:name',
      this._toHandler({ handler: this._handleRenameSession.bind(this) }),
    )
    this._app.delete(
      '/api/instances/:id/sessions/:name',
      this._toHandler({ handler: this._handleDeleteSession.bind(this) }),
    )
    this._app.post(
      '/api/instances/:id/sessions/:name/clone',
      this._toHandler({ handler: this._handleCloneSession.bind(this) }),
    )
    this._app.post(
      '/api/instances/:id/sessions/:name/open-external',
      this._toHandler({ handler: this._handleOpenExternal.bind(this) }),
    )
    this._app.post(
      '/api/instances/:id/sessions/:name/switch',
      this._toHandler({ handler: this._handleSwitchSession.bind(this) }),
    )
    this._app.get('/api/terminals', this._toHandler({ handler: this._handleListTerminals.bind(this) }))
    this._app.get('/api/theme', this._toHandler({ handler: this._handleGetTheme.bind(this) }))
    this._app.post('/api/connection-tests', this._toHandler({ handler: this._handleTestConnection.bind(this) }))
    this._app.put('/api/settings', this._toHandler({ handler: this._handleUpdateSettings.bind(this) }))
    this._app.put('/api/settings/terminal', this._toHandler({ handler: this._handleUpdateTerminalSetting.bind(this) }))
  }

  protected _sendError(params: { error: unknown; res: Response }): void {
    const error = this._toError({ error: params.error })
    const message = this._toMessage({ error })

    params.res.status(this._toStatusCode({ message })).json({ message })
  }

  protected _toAuthHandler(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
      if (!this._isAuthorized({ authorizationHeader: req.headers.authorization })) {
        res.status(401).json({ message: 'Unauthorized' })

        return
      }

      next()
    }
  }

  protected _toCorsHandler(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')

      if (req.method === 'OPTIONS') {
        res.sendStatus(204)

        return
      }

      next()
    }
  }

  protected _toError(params: { error: unknown }): Error {
    if (params.error instanceof Error) {
      return params.error
    }

    return new Error(String(params.error))
  }

  protected _toEventsMode(params: { instanceId: string }): SessionEventsMode {
    if (this._controlModeService.isHealthy({ instanceId: params.instanceId })) {
      return 'control'
    }

    return 'poll'
  }

  protected _toHandler(params: { handler: RouteHandler }): RequestHandler {
    return (req: Request, res: Response, _next: NextFunction) => {
      void this._toHandledResult({ handler: params.handler, req, res })
    }
  }

  protected async _toHandledResult(params: { handler: RouteHandler; req: Request; res: Response }): Promise<void> {
    try {
      await params.handler({ req: params.req, res: params.res })
    } catch (error) {
      this._sendError({ error, res: params.res })
    }
  }

  protected _toInstance(params: { id: string }): IInstance {
    const instance = this._settingsRepo.getInstances().find((knownInstance) => {
      return knownInstance.id === params.id
    })

    if (instance === undefined) {
      throw new Error('Instance not found')
    }

    return instance
  }

  protected _toRouteParam(params: { key: string; req: Request }): string {
    const value = params.req.params[params.key]

    if (typeof value === 'string') {
      return value
    }

    return ''
  }

  protected _toMessage(params: { error: Error }): string {
    const trimmedMessage = params.error.message.trim()

    if (trimmedMessage !== '') {
      return trimmedMessage
    }

    return params.error.name
  }

  protected _toPort(params: { address: AddressInfo | string | null }): number {
    if (typeof params.address === 'object' && params.address !== null) {
      return params.address.port
    }

    return 0
  }

  protected _toStatusCode(params: { message: string }): number {
    if (
      params.message.includes('not found') ||
      params.message.includes("can't find session") ||
      params.message.startsWith('Unknown instance')
    ) {
      return 404
    }

    if (this._isConflictMessage({ message: params.message })) {
      return 409
    }

    if (this._isValidationMessage({ message: params.message })) {
      return 400
    }

    return 500
  }

  protected _toBooleanSettingUpdate(params: { field: string; value: unknown }): Partial<IAppSettings> | null {
    if (params.value === undefined) {
      return null
    }

    if (typeof params.value !== 'boolean') {
      throw new Error(`Settings field '${params.field}' must be a boolean`)
    }

    return { [params.field]: params.value }
  }

  protected _toHotkeyAcceleratorUpdate(params: { value: unknown }): Partial<IAppSettings> | null {
    if (params.value === undefined) {
      return null
    }

    if (typeof params.value !== 'string' || params.value.trim() === '') {
      throw new Error("Settings field 'hotkeyAccelerator' must be a non-empty string")
    }

    return { hotkeyAccelerator: params.value }
  }

  protected _toLaunchTemplatesUpdate(params: { value: unknown }): Partial<IAppSettings> | null {
    if (params.value === undefined) {
      return null
    }

    if (!this._isStringRecord(params.value)) {
      throw new Error("Settings field 'launchTemplates' must be a map of terminal id to template string")
    }

    return { launchTemplates: params.value }
  }

  protected _toUpdatedSettings(params: { current: IAppSettings; update: IUpdateSettingsBody }): IAppSettings {
    const updates = [
      this._toBooleanSettingUpdate({ field: 'confirmBeforeKill', value: params.update.confirmBeforeKill }),
      this._toBooleanSettingUpdate({ field: 'ghosttyThemeImport', value: params.update.ghosttyThemeImport }),
      this._toBooleanSettingUpdate({ field: 'hotkeyEnabled', value: params.update.hotkeyEnabled }),
      this._toHotkeyAcceleratorUpdate({ value: params.update.hotkeyAccelerator }),
      this._toLaunchTemplatesUpdate({ value: params.update.launchTemplates }),
    ].filter((update): update is Partial<IAppSettings> => {
      return update !== null
    })

    return updates.reduce<IAppSettings>((settings, update) => {
      return { ...settings, ...update }
    }, params.current)
  }

  protected _isStringRecord(value: unknown): value is Record<string, string> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return false
    }

    return Object.entries(value).every(([key, entryValue]) => {
      return key !== '' && typeof entryValue === 'string'
    })
  }
}
