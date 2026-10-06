import { type ChildProcess, spawn } from 'node:child_process'

import { type SettingsRepo } from '#src/main/business/repo/settings-repo'
import { tmuxParseUtil } from '#src/main/business/service/tmux-parse-util'
import { type TmuxService } from '#src/main/business/service/tmux-service'
import { SshExecutor } from '#src/main/exec/ssh-executor'
import { LoginPathUtil } from '#src/main/util/login-path-util'
import { shellQuoteUtil } from '#src/main/util/shell-quote-util'
import { type IInstance } from '#src/shared/instance-model'

const CONTROL_BACKOFF_INITIAL_MS = 1000

const CONTROL_BACKOFF_MAX_MS = 30000

const CONTROL_LIVE_RESET_MS = 10000

const REFRESH_DEBOUNCE_MS = 250

export type IControlRefreshCallback = (instanceId: string) => void

interface IControlEntry {
  backoffMs: number
  isStopped: boolean
  proc: ChildProcess | null
  reconnectTimeoutId: ReturnType<typeof setTimeout> | null
  refreshTimeoutId: ReturnType<typeof setTimeout> | null
  startedAtMs: number
}

interface IControlSpawnParams {
  args: string[]
  file: string
}

export class ControlModeService {
  protected readonly _entries = new Map<string, IControlEntry>()

  protected readonly _listeners = new Set<IControlRefreshCallback>()

  protected readonly _loginPathUtil: LoginPathUtil = new LoginPathUtil()

  protected readonly _outputBuffers = new Map<string, string>()

  protected readonly _settingsRepo: SettingsRepo

  protected readonly _tmuxService: TmuxService

  constructor(params: { settingsRepo: SettingsRepo; tmuxService: TmuxService }) {
    this._settingsRepo = params.settingsRepo
    this._tmuxService = params.tmuxService
  }

  isHealthy(params: { instanceId: string }): boolean {
    const entry = this._entries.get(params.instanceId)

    if (entry === undefined || entry.isStopped || entry.proc === null) {
      return false
    }

    return entry.proc.exitCode === null
  }

  onRefresh(params: { callback: IControlRefreshCallback }): () => void {
    this._listeners.add(params.callback)

    return () => {
      this._listeners.delete(params.callback)
    }
  }

  start(params: { instanceId: string }): void {
    const existingEntry = this._entries.get(params.instanceId)

    if (existingEntry !== undefined && !existingEntry.isStopped) {
      return
    }

    const entry: IControlEntry = {
      backoffMs: CONTROL_BACKOFF_INITIAL_MS,
      isStopped: false,
      proc: null,
      reconnectTimeoutId: null,
      refreshTimeoutId: null,
      startedAtMs: 0,
    }

    this._entries.set(params.instanceId, entry)
    void this._connect({ entry, instanceId: params.instanceId })
  }

  stop(params: { instanceId: string }): void {
    const entry = this._entries.get(params.instanceId)

    if (entry === undefined) {
      return
    }

    entry.isStopped = true
    this._clearReconnectTimer({ entry })
    this._clearRefreshTimer({ entry })
    this._entries.delete(params.instanceId)
    this._outputBuffers.delete(params.instanceId)

    if (entry.proc !== null) {
      entry.proc.kill()
      entry.proc = null
    }
  }

  stopAll(): void {
    const instanceIds = [...this._entries.keys()]

    instanceIds.forEach((instanceId) => {
      this.stop({ instanceId })
    })
  }

  protected _clearReconnectTimer(params: { entry: IControlEntry }): void {
    if (params.entry.reconnectTimeoutId !== null) {
      clearTimeout(params.entry.reconnectTimeoutId)
      params.entry.reconnectTimeoutId = null
    }
  }

  protected _clearRefreshTimer(params: { entry: IControlEntry }): void {
    if (params.entry.refreshTimeoutId !== null) {
      clearTimeout(params.entry.refreshTimeoutId)
      params.entry.refreshTimeoutId = null
    }
  }

  protected async _connect(params: { entry: IControlEntry; instanceId: string }): Promise<void> {
    try {
      const instance = this._toInstance({ instanceId: params.instanceId })
      const [spawnParams, path] = await Promise.all([this._toSpawnParams({ instance }), this._loginPathUtil.resolve()])

      if (params.entry.isStopped || this._entries.get(params.instanceId) !== params.entry) {
        return
      }

      if (spawnParams === null) {
        this._scheduleReconnect({ entry: params.entry, instanceId: params.instanceId })

        return
      }

      this._spawn({ entry: params.entry, instanceId: params.instanceId, path, spawnParams })
    } catch {
      this._scheduleReconnect({ entry: params.entry, instanceId: params.instanceId })
    }
  }

  protected _emitRefresh(params: { instanceId: string }): void {
    this._listeners.forEach((callback) => {
      callback(params.instanceId)
    })
  }

  protected _handleOutput(params: { instanceId: string; output: string }): void {
    const bufferedOutput = (this._outputBuffers.get(params.instanceId) ?? '') + params.output
    const lines = bufferedOutput.split('\n')
    const remainder = lines.pop() ?? ''
    const hasRefreshNotification = lines.some((line) => {
      return tmuxParseUtil.isControlRefreshNotification({ line })
    })

    this._outputBuffers.set(params.instanceId, remainder)

    if (hasRefreshNotification) {
      this._scheduleRefresh({ instanceId: params.instanceId })
    }
  }

  protected _handleProcessEnd(params: { instanceId: string }): void {
    const entry = this._entries.get(params.instanceId)

    if (entry === undefined) {
      return
    }

    if (entry.proc === null) {
      return
    }

    const livedMs = Date.now() - entry.startedAtMs

    entry.proc = null
    this._outputBuffers.delete(params.instanceId)
    this._clearRefreshTimer({ entry })

    if (livedMs >= CONTROL_LIVE_RESET_MS) {
      entry.backoffMs = CONTROL_BACKOFF_INITIAL_MS
    }

    this._scheduleReconnect({ entry, instanceId: params.instanceId })
  }

  protected _scheduleReconnect(params: { entry: IControlEntry; instanceId: string }): void {
    if (params.entry.isStopped || params.entry.reconnectTimeoutId !== null) {
      return
    }

    const delayMs = params.entry.backoffMs

    params.entry.backoffMs = Math.min(params.entry.backoffMs * 2, CONTROL_BACKOFF_MAX_MS)

    params.entry.reconnectTimeoutId = setTimeout(() => {
      params.entry.reconnectTimeoutId = null
      void this._connect({ entry: params.entry, instanceId: params.instanceId })
    }, delayMs)
  }

  protected _scheduleRefresh(params: { instanceId: string }): void {
    const entry = this._entries.get(params.instanceId)

    if (entry === undefined) {
      return
    }

    if (entry.refreshTimeoutId !== null) {
      return
    }

    entry.refreshTimeoutId = setTimeout(() => {
      entry.refreshTimeoutId = null
      this._emitRefresh({ instanceId: params.instanceId })
    }, REFRESH_DEBOUNCE_MS)
  }

  protected _spawn(params: {
    entry: IControlEntry
    instanceId: string
    path: string
    spawnParams: IControlSpawnParams
  }): void {
    const proc = spawn(params.spawnParams.file, params.spawnParams.args, {
      env: this._toEnv({ path: params.path }),
      stdio: ['pipe', 'pipe', 'ignore'],
    })

    params.entry.proc = proc
    params.entry.startedAtMs = Date.now()

    proc.stdout.on('data', (chunk: Buffer) => {
      this._handleOutput({ instanceId: params.instanceId, output: chunk.toString() })
    })

    proc.on('error', () => {
      this._handleProcessEnd({ instanceId: params.instanceId })
    })

    proc.on('exit', () => {
      this._handleProcessEnd({ instanceId: params.instanceId })
    })
  }

  protected _toEnv(params: { path: string }): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = { ...process.env }

    env['PATH'] = params.path

    return env
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

  protected async _toSpawnParams(params: { instance: IInstance }): Promise<IControlSpawnParams | null> {
    const targetArgs = await this._toTargetArgs({ instance: params.instance })

    if (targetArgs === null) {
      return null
    }

    if (params.instance.type === 'ssh') {
      return this._toSshSpawnParams({ instance: params.instance, targetArgs })
    }

    return { args: ['-C', ...targetArgs], file: 'tmux' }
  }

  protected async _toTargetArgs(params: { instance: IInstance }): Promise<string[] | null> {
    const sessions = await this._tmuxService.listSessions({ instance: params.instance })
    const mostRecentSession = sessions[0]

    if (mostRecentSession !== undefined) {
      return ['attach-session', '-t', `=${mostRecentSession.name}`]
    }

    return null
  }

  protected _toSshSpawnParams(params: { instance: IInstance; targetArgs: string[] }): IControlSpawnParams {
    if (params.instance.ssh === undefined) {
      throw new Error(`Instance '${params.instance.label}' is missing ssh configuration`)
    }

    const sshExecutor = new SshExecutor({ ssh: params.instance.ssh })
    const tmuxCommandWords = sshExecutor.toTmuxCommandWords({ args: ['-C', ...params.targetArgs] }).map((word) => {
      return shellQuoteUtil.toShellWord(word)
    })

    return {
      args: [...sshExecutor.toConnectionOptions(), sshExecutor.toTarget(), '--', ...tmuxCommandWords],
      file: 'ssh',
    }
  }
}
