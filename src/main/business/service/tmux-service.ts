import {
  type ITerminalSelectionBufferRow,
  terminalSelectionUtil,
} from '#src/main/business/service/terminal-selection-util'
import {
  type ITmuxClientRow,
  type ITmuxPaneScrollState,
  type ITmuxSessionRow,
  tmuxParseUtil,
} from '#src/main/business/service/tmux-parse-util'
import { type IExecutor, executorFactory } from '#src/main/exec/executor'
import { type IExecFileResult } from '#src/main/util/exec-file-util'
import { type IInstance } from '#src/shared/instance-model'
import { type ISessionInfo } from '#src/shared/session-model'
import { sessionNamingUtil } from '#src/shared/session-naming-util'
import { type TerminalScrollDirection } from '#src/shared/terminal-scroll-model'

export class TmuxService {
  async cloneSession(params: { instance: IInstance; sourceName: string; targetName: string }): Promise<string> {
    const startPath = await this._readSessionPath({ instance: params.instance, name: params.sourceName })

    return await this.createSession({ instance: params.instance, name: params.targetName, startPath })
  }

  async copyPaneSelection(params: { clientTty: string; instance: IInstance }): Promise<void> {
    const result = await this._toExecutor(params.instance).run([
      'send-keys',
      '-t',
      params.clientTty,
      '-X',
      'copy-pipe-and-cancel',
    ])

    this._assertSuccess({ result })
  }

  async createSession(params: { instance: IInstance; name?: string; startPath?: string }): Promise<string> {
    const name = await this._toName({ instance: params.instance, name: params.name })
    const result = await this._toExecutor(params.instance).run(
      this._toNewSessionArgs({ name, startPath: params.startPath }),
    )

    this._assertSuccess({ result })

    return name
  }

  async enterCopyMode(params: { clientTty: string; instance: IInstance }): Promise<void> {
    const result = await this._toExecutor(params.instance).run(['copy-mode', '-t', params.clientTty])

    this._assertSuccess({ result })
  }

  async exitCopyMode(params: { clientTty: string; instance: IInstance }): Promise<void> {
    const result = await this._toExecutor(params.instance).run(['copy-mode', '-q', '-t', params.clientTty])

    this._assertSuccess({ result })
  }

  async enableSessionMouse(params: { instance: IInstance; name: string }): Promise<void> {
    await this._assertSessionExists({ instance: params.instance, name: params.name })

    const result = await this._toExecutor(params.instance).run(['set-option', '-t', `=${params.name}:`, 'mouse', 'on'])

    this._assertSuccess({ result })
  }

  async killActiveSession(params: { clientTty: string; instance: IInstance }): Promise<void> {
    const clients = await this.listClients({ instance: params.instance })
    const activeClient = clients.find((client) => {
      return client.tty === params.clientTty
    })

    if (activeClient === undefined) {
      throw new Error(`No tmux client attached on '${params.clientTty}'`)
    }

    const rows = await this._listSessionRows({ instance: params.instance })
    const killPlan = tmuxParseUtil.toKillPlan({ rows, victimName: activeClient.session })

    if (killPlan.type === 'switch') {
      await this.switchClient({ clientTty: params.clientTty, instance: params.instance, name: killPlan.name })
    }

    await this.killSession({ instance: params.instance, name: activeClient.session })
  }

  async killSession(params: { instance: IInstance; name: string }): Promise<void> {
    const result = await this._toExecutor(params.instance).run(['kill-session', '-t', `=${params.name}`])

    this._assertSuccess({ result })
  }

  async listBufferRows(params: { instance: IInstance }): Promise<ITerminalSelectionBufferRow[]> {
    const result = await this._toExecutor(params.instance).run([
      'list-buffers',
      '-F',
      '#{buffer_created}\t#{buffer_name}',
    ])

    this._assertSuccess({ result })

    return terminalSelectionUtil.toBufferRows({ stdout: result.stdout })
  }

  async listClients(params: { instance: IInstance }): Promise<ITmuxClientRow[]> {
    const result = await this._toExecutor(params.instance).run([
      'list-clients',
      '-F',
      '#{client_tty}\t#{client_session}\t#{client_activity}',
    ])

    this._assertListSuccess({ isClientList: true, result })

    return tmuxParseUtil.parseClientOutput({ stderr: result.stderr, stdout: result.stdout })
  }

  async listRawSessionNames(params: { instance: IInstance }): Promise<string[]> {
    const rows = await this._listSessionRows({ instance: params.instance })

    return rows.map((row) => {
      return row.name
    })
  }

  async listSessions(params: { activeSessionName?: string | null; instance: IInstance }): Promise<ISessionInfo[]> {
    const rows = await this._listSessionRows({ instance: params.instance })

    return tmuxParseUtil.toSessionInfos({
      activeSessionName: params.activeSessionName ?? null,
      rows,
    })
  }

  async readBufferText(params: { instance: IInstance; name: string }): Promise<string> {
    const result = await this._toExecutor(params.instance).run(['show-buffer', '-b', params.name])

    this._assertSuccess({ result })

    return result.stdout
  }

  async readPaneScrollState(params: { clientTty: string; instance: IInstance }): Promise<ITmuxPaneScrollState | null> {
    const result = await this._toExecutor(params.instance).run([
      'display-message',
      '-p',
      '-t',
      params.clientTty,
      '#{alternate_on}\t#{pane_in_mode}\t#{scroll_position}\t#{history_size}',
    ])

    this._assertSuccess({ result })

    return tmuxParseUtil.parsePaneScrollState({ stdout: result.stdout })
  }

  protected async _readSessionPath(params: { instance: IInstance; name: string }): Promise<string | undefined> {
    await this._assertSessionExists({ instance: params.instance, name: params.name })

    const result = await this._toExecutor(params.instance).run([
      'display-message',
      '-p',
      '-t',
      `=${params.name}:`,
      '#{pane_current_path}',
    ])

    this._assertSuccess({ result })

    const currentPath = result.stdout.trim()

    if (currentPath === '') {
      return undefined
    }

    return currentPath
  }

  async renameSession(params: { currentName: string; instance: IInstance; nextName: string }): Promise<void> {
    const validationError = sessionNamingUtil.validateSessionName(params.nextName)

    if (validationError !== null) {
      throw new Error(validationError)
    }

    const rows = await this._listSessionRows({ instance: params.instance })
    const isDuplicateName = this._isDuplicateName({
      currentName: params.currentName,
      nextName: params.nextName,
      rows,
    })

    if (isDuplicateName) {
      throw new Error(`Session name '${params.nextName}' is already in use`)
    }

    const result = await this._toExecutor(params.instance).run([
      'rename-session',
      '-t',
      `=${params.currentName}`,
      params.nextName,
    ])

    this._assertSuccess({ result })
  }

  async scrollCopyMode(params: {
    clientTty: string
    direction: TerminalScrollDirection
    instance: IInstance
    lines: number
  }): Promise<void> {
    const result = await this._toExecutor(params.instance).run([
      'send-keys',
      '-t',
      params.clientTty,
      '-X',
      '-N',
      String(params.lines),
      this._toCopyModeScrollCommand({ direction: params.direction }),
    ])

    this._assertSuccess({ result })
  }

  async switchClient(params: { clientTty: string; instance: IInstance; name: string }): Promise<void> {
    const result = await this._toExecutor(params.instance).run([
      'switch-client',
      '-c',
      params.clientTty,
      '-t',
      `=${params.name}`,
    ])

    this._assertSuccess({ result })
  }

  protected _assertListSuccess(params: { isClientList: boolean; result: IExecFileResult }): void {
    if (params.isClientList) {
      if (tmuxParseUtil.isAbsentClientOutput({ stderr: params.result.stderr })) {
        return
      }
    } else if (tmuxParseUtil.isAbsentSessionOutput({ stderr: params.result.stderr })) {
      return
    }

    this._assertSuccess({ result: params.result })
  }

  protected async _assertSessionExists(params: { instance: IInstance; name: string }): Promise<void> {
    const result = await this._toExecutor(params.instance).run(['has-session', '-t', `=${params.name}`])

    this._assertSuccess({ result })
  }

  protected _assertSuccess(params: { result: IExecFileResult }): void {
    if (params.result.code === 0) {
      return
    }

    const stderrMessage = params.result.stderr.trim()

    if (stderrMessage !== '') {
      throw new Error(stderrMessage)
    }

    throw new Error(`tmux command failed with exit code ${String(params.result.code)}`)
  }

  protected _isDuplicateName(params: { currentName: string; nextName: string; rows: ITmuxSessionRow[] }): boolean {
    return params.rows.some((row) => {
      return row.name === params.nextName && row.name !== params.currentName
    })
  }

  protected async _listSessionRows(params: { instance: IInstance }): Promise<ITmuxSessionRow[]> {
    const result = await this._toExecutor(params.instance).run([
      'list-sessions',
      '-F',
      '#{session_name}\t#{session_windows}\t#{session_attached}\t#{session_last_attached}',
    ])

    this._assertListSuccess({ isClientList: false, result })

    return tmuxParseUtil.parseSessionOutput({ stderr: result.stderr, stdout: result.stdout })
  }

  protected async _toName(params: { instance: IInstance; name?: string }): Promise<string> {
    if (params.name !== undefined && params.name !== '') {
      return params.name
    }

    const rows = await this._listSessionRows({ instance: params.instance })

    return sessionNamingUtil.toNextSessionName({
      names: rows.map((row) => {
        return row.name
      }),
    })
  }

  protected _toCopyModeScrollCommand(params: { direction: TerminalScrollDirection }): string {
    switch (params.direction) {
      case 'down': {
        return 'scroll-down'
      }

      case 'up': {
        return 'scroll-up'
      }

      default: {
        throw new Error(`Unsupported scroll direction '${String(params.direction)}'`)
      }
    }
  }

  protected _toExecutor(instance: IInstance): IExecutor {
    return executorFactory.create({ instance })
  }

  protected _toNewSessionArgs(params: { name: string; startPath?: string }): string[] {
    if (params.startPath === undefined) {
      return ['new-session', '-d', '-s', params.name]
    }

    return ['new-session', '-d', '-s', params.name, '-c', params.startPath]
  }
}
