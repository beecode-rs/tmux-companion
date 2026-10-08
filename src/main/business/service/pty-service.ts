import { clipboard } from 'electron'
import { type IPty, spawn } from 'node-pty'
import { homedir } from 'node:os'

import { type SettingsRepo } from '#src/main/business/repo/settings-repo'
import { type TerminalScrollPlan, terminalScrollUtil } from '#src/main/business/service/terminal-scroll-util'
import { terminalSelectionUtil } from '#src/main/business/service/terminal-selection-util'
import { tmuxParseUtil } from '#src/main/business/service/tmux-parse-util'
import { type TmuxService } from '#src/main/business/service/tmux-service'
import { SshExecutor } from '#src/main/exec/ssh-executor'
import { LoginPathUtil } from '#src/main/util/login-path-util'
import { shellQuoteUtil } from '#src/main/util/shell-quote-util'
import { type IInstance } from '#src/shared/instance-model'
import { type TerminalMode } from '#src/shared/terminal-mode-model'
import {
  type IScrollStateFrame,
  type TerminalCursorKeys,
  type TerminalScrollDirection,
} from '#src/shared/terminal-scroll-model'

const CLIENT_TTY_RESOLUTION_DELAY_MS = 500

const CLIENT_TTY_RESOLUTION_MAX_ATTEMPTS = 2

const CLIENT_TTY_RESOLUTION_RETRY_DELAY_MS = 2000

const COPY_SELECTION_BUFFER_MAX_AGE_SECONDS = 2

const COPY_SELECTION_BUFFER_POLL_ATTEMPTS = 3

const COPY_SELECTION_BUFFER_POLL_DELAY_MS = 150

const DEFAULT_COLS = 80

const DEFAULT_ROWS = 24

const EMPTY_SCROLL_STATE_FRAME: IScrollStateFrame = { historySize: 0, isInCopyMode: false, scrollPosition: 0 }

const MACHINE_FALLBACK_SHELL = '/bin/zsh'

export interface IPtyExitReason {
  exitCode: number
  signal?: number
}

export type IPtyDataCallback = (data: string) => void

export type IPtyExitCallback = (reason: IPtyExitReason) => void

interface IPtyEntry {
  clientTty: string | null
  exitReason: IPtyExitReason | null
  pty: IPty
  startName: string
}

interface IPtyListenerSets {
  dataCallbacks: Set<IPtyDataCallback>
  exitCallbacks: Set<IPtyExitCallback>
}

export class PtyService {
  protected readonly _listeners = new Map<string, IPtyListenerSets>()

  protected readonly _loginPathUtil: LoginPathUtil = new LoginPathUtil()

  protected readonly _pendingCreates = new Map<string, Promise<IPty>>()

  protected readonly _ptys = new Map<string, IPtyEntry>()

  protected readonly _settingsRepo: SettingsRepo

  protected readonly _tmuxService: TmuxService

  constructor(params: { settingsRepo: SettingsRepo; tmuxService: TmuxService }) {
    this._settingsRepo = params.settingsRepo
    this._tmuxService = params.tmuxService
  }

  async copySelection(params: { instanceId: string; mode: TerminalMode }): Promise<string | null> {
    if (params.mode !== 'tmux') {
      return null
    }

    try {
      const entry = this._ptys.get(this._toTmuxKey({ instanceId: params.instanceId }))

      if (entry?.exitReason !== null) {
        return null
      }

      const clientTty = await this.getOrResolveClientTty({ instanceId: params.instanceId })

      if (clientTty === null) {
        return null
      }

      const instance = this._toInstance({ instanceId: params.instanceId })
      const minCreatedEpochSeconds = Math.floor(Date.now() / 1000) - COPY_SELECTION_BUFFER_MAX_AGE_SECONDS

      await this._copyPaneSelectionBestEffort({ clientTty, instance })

      const rawBufferText = await this._waitForRecentBufferText({ attempt: 1, instance, minCreatedEpochSeconds })

      if (rawBufferText === null) {
        return null
      }

      const clipboardText = terminalSelectionUtil.toClipboardText({ raw: rawBufferText })

      clipboard.writeText(clipboardText)

      return clipboardText
    } catch {
      return null
    }
  }

  destroy(params: { instanceId: string; mode?: TerminalMode }): void {
    if (params.mode === undefined) {
      this._destroyKey({ key: this._toKey({ instanceId: params.instanceId, mode: 'machine' }) })
      this._destroyKey({ key: this._toKey({ instanceId: params.instanceId, mode: 'tmux' }) })

      return
    }

    this._destroyKey({ key: this._toKey({ instanceId: params.instanceId, mode: params.mode }) })
  }

  destroyAll(): void {
    const keys = [...this._ptys.keys()]

    keys.forEach((key) => {
      this._destroyKey({ key })
    })
  }

  async getOrCreate(params: { instanceId: string; mode: TerminalMode }): Promise<IPty> {
    const key = this._toKey({ instanceId: params.instanceId, mode: params.mode })
    const existingEntry = this._ptys.get(key)

    if (existingEntry?.exitReason === null) {
      return existingEntry.pty
    }

    const pendingCreate = this._pendingCreates.get(key)

    if (pendingCreate !== undefined) {
      return await pendingCreate
    }

    const create = this._createPty({ instanceId: params.instanceId, mode: params.mode })

    this._pendingCreates.set(key, create)

    try {
      return await create
    } finally {
      this._pendingCreates.delete(key)
    }
  }

  getClientTty(params: { instanceId: string }): string | null {
    return this._ptys.get(this._toTmuxKey({ instanceId: params.instanceId }))?.clientTty ?? null
  }

  async getOrResolveClientTty(params: { instanceId: string }): Promise<string | null> {
    const cachedClientTty = this.getClientTty({ instanceId: params.instanceId })

    if (cachedClientTty !== null) {
      return cachedClientTty
    }

    return await this.resolveClientTty({ instanceId: params.instanceId })
  }

  async getScrollState(params: { instanceId: string; mode: TerminalMode }): Promise<IScrollStateFrame> {
    if (params.mode === 'machine') {
      return EMPTY_SCROLL_STATE_FRAME
    }

    try {
      const entry = this._ptys.get(this._toTmuxKey({ instanceId: params.instanceId }))

      if (entry?.exitReason !== null) {
        return EMPTY_SCROLL_STATE_FRAME
      }

      const clientTty = await this.getOrResolveClientTty({ instanceId: params.instanceId })

      if (clientTty === null) {
        return EMPTY_SCROLL_STATE_FRAME
      }

      const instance = this._toInstance({ instanceId: params.instanceId })
      const paneScrollState = await this._tmuxService.readPaneScrollState({ clientTty, instance })

      if (paneScrollState === null) {
        return EMPTY_SCROLL_STATE_FRAME
      }

      return {
        historySize: paneScrollState.historySize,
        isInCopyMode: paneScrollState.isInCopyMode,
        scrollPosition: paneScrollState.scrollPosition,
      }
    } catch {
      return EMPTY_SCROLL_STATE_FRAME
    }
  }

  onData(params: { callback: IPtyDataCallback; instanceId: string; mode: TerminalMode }): () => void {
    const listenerSets = this._toListenerSets({ key: this._toKey(params) })

    listenerSets.dataCallbacks.add(params.callback)

    return () => {
      listenerSets.dataCallbacks.delete(params.callback)
    }
  }

  onExit(params: { callback: IPtyExitCallback; instanceId: string; mode: TerminalMode }): () => void {
    const listenerSets = this._toListenerSets({ key: this._toKey(params) })

    listenerSets.exitCallbacks.add(params.callback)

    return () => {
      listenerSets.exitCallbacks.delete(params.callback)
    }
  }

  resize(params: { cols: number; instanceId: string; mode: TerminalMode; rows: number }): void {
    const entry = this._ptys.get(this._toKey(params))

    if (entry?.exitReason !== null) {
      return
    }

    entry.pty.resize(params.cols, params.rows)
  }

  async resolveClientTty(params: { instanceId: string }): Promise<string | null> {
    const entry = this._ptys.get(this._toTmuxKey({ instanceId: params.instanceId }))

    if (entry?.exitReason !== null) {
      return null
    }

    const instance = this._toInstance({ instanceId: params.instanceId })
    const clientRows = await this._tmuxService.listClients({ instance })
    const clientTty = tmuxParseUtil.toClientTty({ clientRows, sessionName: entry.startName })

    entry.clientTty = clientTty

    return clientTty
  }

  async scroll(params: {
    cursorKeys: TerminalCursorKeys
    direction: TerminalScrollDirection
    instanceId: string
    lines: number
    mode: TerminalMode
  }): Promise<void> {
    if (params.mode === 'machine') {
      this._writeArrowKeys({
        cursorKeys: params.cursorKeys,
        direction: params.direction,
        instanceId: params.instanceId,
        lines: params.lines,
        mode: params.mode,
      })

      return
    }

    const entry = this._ptys.get(this._toTmuxKey({ instanceId: params.instanceId }))

    if (entry?.exitReason !== null) {
      return
    }

    const clientTty = await this.getOrResolveClientTty({ instanceId: params.instanceId })

    if (clientTty === null) {
      return
    }

    const instance = this._toInstance({ instanceId: params.instanceId })
    const paneScrollState = await this._tmuxService.readPaneScrollState({ clientTty, instance })

    if (paneScrollState === null) {
      return
    }

    const plan = terminalScrollUtil.toScrollPlan({
      cursorKeys: params.cursorKeys,
      direction: params.direction,
      isAlternateOn: paneScrollState.isAlternateOn,
      isInCopyMode: paneScrollState.isInCopyMode,
      lines: params.lines,
      scrollPosition: paneScrollState.scrollPosition,
    })

    await this._executeScrollPlan({ clientTty, instance, instanceId: params.instanceId, plan })
  }

  async switchAttachedClient(params: { instance: IInstance; name: string }): Promise<void> {
    const clientTty = await this.getOrResolveClientTty({ instanceId: params.instance.id })

    if (clientTty === null) {
      throw new Error('No attached tmux client for this instance')
    }

    const firstAttempt = await this._toSwitchAttemptResult({
      clientTty,
      instance: params.instance,
      name: params.name,
    })

    if (firstAttempt === null) {
      await this._enableSessionMouseBestEffort({ instanceId: params.instance.id, name: params.name })

      return
    }

    const retryClientTty = await this.resolveClientTty({ instanceId: params.instance.id })

    if (retryClientTty === null) {
      throw firstAttempt
    }

    const retryAttempt = await this._toSwitchAttemptResult({
      clientTty: retryClientTty,
      instance: params.instance,
      name: params.name,
    })

    if (retryAttempt !== null) {
      throw retryAttempt
    }

    await this._enableSessionMouseBestEffort({ instanceId: params.instance.id, name: params.name })
  }

  write(params: { data: string; instanceId: string; mode: TerminalMode }): void {
    const entry = this._ptys.get(this._toKey(params))

    if (entry?.exitReason !== null) {
      return
    }

    entry.pty.write(params.data)
  }

  protected async _createPty(params: { instanceId: string; mode: TerminalMode }): Promise<IPty> {
    const instance = this._toInstance({ instanceId: params.instanceId })
    const path = await this._loginPathUtil.resolve()

    if (params.mode === 'machine') {
      this.destroy({ instanceId: params.instanceId, mode: 'tmux' })

      const machineEntry = this._spawnForInstance({
        instance,
        instanceId: params.instanceId,
        mode: params.mode,
        path,
        startName: '',
      })

      return machineEntry.pty
    }

    const startName = await this._toStartName({ instance })
    const entry = this._spawnForInstance({
      instance,
      instanceId: params.instanceId,
      mode: params.mode,
      path,
      startName,
    })

    this._scheduleClientTtyResolution({ instanceId: params.instanceId })

    return entry.pty
  }

  protected _destroyAfterPendingCreate(params: { key: string }): void {
    const pendingCreate = this._pendingCreates.get(params.key)

    if (pendingCreate === undefined) {
      return
    }

    void pendingCreate
      .then(() => {
        this._destroyKey({ key: params.key })
      })
      .catch(() => {
        return undefined
      })
  }

  protected _destroyKey(params: { key: string }): void {
    const listenerSets = this._listeners.get(params.key)

    this._listeners.delete(params.key)
    this._destroyAfterPendingCreate({ key: params.key })

    const entry = this._ptys.get(params.key)

    if (entry === undefined) {
      return
    }

    this._ptys.delete(params.key)

    if (entry.exitReason !== null) {
      return
    }

    entry.pty.kill()
    listenerSets?.exitCallbacks.forEach((callback) => {
      callback({ exitCode: 0 })
    })
  }

  protected _dispatchData(params: { data: string; key: string; pty: IPty }): void {
    if (this._ptys.get(params.key)?.pty !== params.pty) {
      return
    }

    this._listeners.get(params.key)?.dataCallbacks.forEach((callback) => {
      callback(params.data)
    })
  }

  protected async _executeScrollPlan(params: {
    clientTty: string
    instance: IInstance
    instanceId: string
    plan: TerminalScrollPlan
  }): Promise<void> {
    switch (params.plan.type) {
      case 'exit-copy-mode': {
        await this._tmuxService.exitCopyMode({ clientTty: params.clientTty, instance: params.instance })

        return
      }

      case 'ignore': {
        return
      }

      case 'scroll-after-entering-copy-mode': {
        await this._tmuxService.enterCopyMode({ clientTty: params.clientTty, instance: params.instance })
        await this._tmuxService.scrollCopyMode({
          clientTty: params.clientTty,
          direction: params.plan.direction,
          instance: params.instance,
          lines: params.plan.lines,
        })

        return
      }

      case 'scroll-in-copy-mode': {
        await this._tmuxService.scrollCopyMode({
          clientTty: params.clientTty,
          direction: params.plan.direction,
          instance: params.instance,
          lines: params.plan.lines,
        })

        return
      }

      case 'write-arrow-keys': {
        this.write({ data: params.plan.data, instanceId: params.instanceId, mode: 'tmux' })

        return
      }

      default: {
        throw new Error(`Unsupported scroll plan type '${String(params.plan)}'`)
      }
    }
  }

  protected _handleExit(params: { key: string; pty: IPty; reason: IPtyExitReason }): void {
    const entry = this._ptys.get(params.key)

    if (entry?.pty !== params.pty) {
      return
    }

    entry.clientTty = null
    entry.exitReason = params.reason

    this._listeners.get(params.key)?.exitCallbacks.forEach((callback) => {
      callback(params.reason)
    })
  }

  protected async _attemptClientTtyResolution(params: { attempt: number; instanceId: string }): Promise<void> {
    await this._delay({ durationMs: this._toResolutionDelayMs({ attempt: params.attempt }) })

    const entry = this._ptys.get(this._toTmuxKey({ instanceId: params.instanceId }))

    if (entry?.exitReason !== null) {
      return
    }

    const clientTty = await this.resolveClientTty({ instanceId: params.instanceId })

    if (clientTty !== null) {
      await this._enableSessionMouseBestEffort({ instanceId: params.instanceId, name: entry.startName })

      return
    }

    if (params.attempt >= CLIENT_TTY_RESOLUTION_MAX_ATTEMPTS) {
      return
    }

    void this._attemptClientTtyResolution({ attempt: params.attempt + 1, instanceId: params.instanceId })
  }

  protected async _copyPaneSelectionBestEffort(params: { clientTty: string; instance: IInstance }): Promise<void> {
    try {
      await this._tmuxService.copyPaneSelection({ clientTty: params.clientTty, instance: params.instance })
    } catch {
      return
    }
  }

  protected async _enableSessionMouseBestEffort(params: { instanceId: string; name: string }): Promise<void> {
    try {
      const instance = this._toInstance({ instanceId: params.instanceId })

      await this._tmuxService.enableSessionMouse({ instance, name: params.name })
    } catch {
      return
    }
  }

  protected async _readBufferTextBestEffort(params: { instance: IInstance; name: string }): Promise<string | null> {
    try {
      return await this._tmuxService.readBufferText({ instance: params.instance, name: params.name })
    } catch {
      return null
    }
  }

  protected async _toRecentBufferNameBestEffort(params: {
    instance: IInstance
    minCreatedEpochSeconds: number
  }): Promise<string | null> {
    try {
      const rows = await this._tmuxService.listBufferRows({ instance: params.instance })

      return terminalSelectionUtil.toNewestRecentBufferName({
        minCreatedEpochSeconds: params.minCreatedEpochSeconds,
        rows,
      })
    } catch {
      return null
    }
  }

  protected async _waitForRecentBufferText(params: {
    attempt: number
    instance: IInstance
    minCreatedEpochSeconds: number
  }): Promise<string | null> {
    if (params.attempt > COPY_SELECTION_BUFFER_POLL_ATTEMPTS) {
      return null
    }

    const bufferName = await this._toRecentBufferNameBestEffort({
      instance: params.instance,
      minCreatedEpochSeconds: params.minCreatedEpochSeconds,
    })

    if (bufferName !== null) {
      return await this._readBufferTextBestEffort({ instance: params.instance, name: bufferName })
    }

    await this._delay({ durationMs: COPY_SELECTION_BUFFER_POLL_DELAY_MS })

    return await this._waitForRecentBufferText({
      attempt: params.attempt + 1,
      instance: params.instance,
      minCreatedEpochSeconds: params.minCreatedEpochSeconds,
    })
  }

  protected _delay(params: { durationMs: number }): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, params.durationMs)
    })
  }

  protected _scheduleClientTtyResolution(params: { instanceId: string }): void {
    void this._attemptClientTtyResolution({ attempt: 1, instanceId: params.instanceId })
  }

  protected _toResolutionDelayMs(params: { attempt: number }): number {
    if (params.attempt <= 1) {
      return CLIENT_TTY_RESOLUTION_DELAY_MS
    }

    return CLIENT_TTY_RESOLUTION_RETRY_DELAY_MS
  }

  protected _spawnForInstance(params: {
    instance: IInstance
    instanceId: string
    mode: TerminalMode
    path: string
    startName: string
  }): IPtyEntry {
    const spawnParams = this._toSpawnParams({
      instance: params.instance,
      mode: params.mode,
      startName: params.startName,
    })
    const key = this._toKey({ instanceId: params.instanceId, mode: params.mode })
    const pty = spawn(spawnParams.file, spawnParams.args, {
      cols: DEFAULT_COLS,
      cwd: this._toCwd({ mode: params.mode }),
      env: this._toEnv({ path: params.path }),
      name: 'xterm-256color',
      rows: DEFAULT_ROWS,
    })
    const entry: IPtyEntry = { clientTty: null, exitReason: null, pty, startName: params.startName }

    pty.onData((data: string) => {
      this._dispatchData({ data, key, pty })
    })
    pty.onExit((reason: IPtyExitReason) => {
      this._handleExit({ key, pty, reason })
    })

    this._ptys.set(key, entry)

    return entry
  }

  protected _toCwd(params: { mode: TerminalMode }): string | undefined {
    if (params.mode === 'machine') {
      return homedir()
    }

    return undefined
  }

  protected _toEnv(params: { path: string }): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = { ...process.env }

    env['PATH'] = params.path
    env['TERM'] = 'xterm-256color'

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

  protected _toKey(params: { instanceId: string; mode: TerminalMode }): string {
    return `${params.instanceId}:${params.mode}`
  }

  protected _toListenerSets(params: { key: string }): IPtyListenerSets {
    const existingSets = this._listeners.get(params.key)

    if (existingSets !== undefined) {
      return existingSets
    }

    const listenerSets: IPtyListenerSets = { dataCallbacks: new Set(), exitCallbacks: new Set() }

    this._listeners.set(params.key, listenerSets)

    return listenerSets
  }

  protected _toMachineSpawnParams(params: { instance: IInstance }): { args: string[]; file: string } {
    if (params.instance.type === 'ssh') {
      return this._toSshMachineSpawnParams({ instance: params.instance })
    }

    return { args: ['-l'], file: process.env.SHELL ?? MACHINE_FALLBACK_SHELL }
  }

  protected async _toSwitchAttemptResult(params: {
    clientTty: string
    instance: IInstance
    name: string
  }): Promise<Error | null> {
    try {
      await this._tmuxService.switchClient({
        clientTty: params.clientTty,
        instance: params.instance,
        name: params.name,
      })

      return null
    } catch (error) {
      return this._toError({ error })
    }
  }

  protected _toError(params: { error: unknown }): Error {
    if (params.error instanceof Error) {
      return params.error
    }

    return new Error(String(params.error))
  }

  protected _toSpawnParams(params: { instance: IInstance; mode: TerminalMode; startName: string }): {
    args: string[]
    file: string
  } {
    if (params.mode === 'machine') {
      return this._toMachineSpawnParams({ instance: params.instance })
    }

    if (params.instance.type === 'ssh') {
      return this._toSshSpawnParams({ instance: params.instance, startName: params.startName })
    }

    return { args: ['new-session', '-A', '-s', params.startName], file: 'tmux' }
  }

  protected _toSshMachineSpawnParams(params: { instance: IInstance }): { args: string[]; file: string } {
    if (params.instance.ssh === undefined) {
      throw new Error(`Instance '${params.instance.label}' is missing ssh configuration`)
    }

    const sshExecutor = new SshExecutor({ ssh: params.instance.ssh })

    return {
      args: [...sshExecutor.toConnectionOptions({ isInteractive: true }), '-t', sshExecutor.toTarget()],
      file: 'ssh',
    }
  }

  protected _toSshSpawnParams(params: { instance: IInstance; startName: string }): { args: string[]; file: string } {
    if (params.instance.ssh === undefined) {
      throw new Error(`Instance '${params.instance.label}' is missing ssh configuration`)
    }

    const sshExecutor = new SshExecutor({ ssh: params.instance.ssh })
    const tmuxCommandWords = sshExecutor
      .toTmuxCommandWords({ args: ['new-session', '-A', '-s', params.startName] })
      .map((word) => {
        return shellQuoteUtil.toShellWord(word)
      })

    return {
      args: [
        ...sshExecutor.toConnectionOptions({ isInteractive: true }),
        '-t',
        sshExecutor.toTarget(),
        '--',
        ...tmuxCommandWords,
      ],
      file: 'ssh',
    }
  }

  protected async _toStartName(params: { instance: IInstance }): Promise<string> {
    const sessions = await this._tmuxService.listSessions({ instance: params.instance })
    const lastSession = params.instance.lastSession

    if (lastSession !== undefined) {
      const isLastSessionKnown = sessions.some((session) => {
        return session.name === lastSession
      })

      if (isLastSessionKnown) {
        return lastSession
      }
    }

    const mostRecentSession = sessions[0]

    if (mostRecentSession !== undefined) {
      return mostRecentSession.name
    }

    return 's01'
  }

  protected _toTmuxKey(params: { instanceId: string }): string {
    return this._toKey({ instanceId: params.instanceId, mode: 'tmux' })
  }

  protected _writeArrowKeys(params: {
    cursorKeys: TerminalCursorKeys
    direction: TerminalScrollDirection
    instanceId: string
    lines: number
    mode: TerminalMode
  }): void {
    this.write({
      data: terminalScrollUtil.toArrowKeys({
        cursorKeys: params.cursorKeys,
        direction: params.direction,
        lines: params.lines,
      }),
      instanceId: params.instanceId,
      mode: params.mode,
    })
  }
}
