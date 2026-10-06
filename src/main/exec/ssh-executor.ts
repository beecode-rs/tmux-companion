import { type IExecutor } from '#src/main/exec/executor'
import { ExecFileUtil, type IExecFileResult } from '#src/main/util/exec-file-util'
import { shellQuoteUtil } from '#src/main/util/shell-quote-util'
import { type IInstanceSshConfig } from '#src/shared/instance-model'

const BACKGROUND_ONLY_CONNECTION_OPTIONS = ['-o', 'BatchMode=yes']

const REMOTE_TMUX_SEARCH_PATH = [
  '/opt/homebrew/bin',
  '/opt/local/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
].join(':')

const SHARED_CONNECTION_OPTIONS = [
  '-o',
  'ControlMaster=auto',
  '-o',
  'ControlPath=~/.ssh/cm-%C',
  '-o',
  'ControlPersist=10m',
  '-o',
  'StrictHostKeyChecking=accept-new',
  '-o',
  'ConnectTimeout=10',
]

export class SshExecutor implements IExecutor {
  protected readonly _ssh: IInstanceSshConfig

  constructor(params: { ssh: IInstanceSshConfig }) {
    this._ssh = params.ssh
  }

  run(args: string[]): Promise<IExecFileResult> {
    const quotedWords = this.toTmuxCommandWords({ args }).map((word) => {
      return shellQuoteUtil.toShellWord(word)
    })

    return new ExecFileUtil().toResult({
      args: [...this.toConnectionOptions(), this.toTarget(), '--', ...quotedWords],
      file: 'ssh',
    })
  }

  toTmuxCommandWords(params: { args: readonly string[] }): string[] {
    const { args } = params

    return ['env', `PATH=${REMOTE_TMUX_SEARCH_PATH}`, 'tmux', ...args]
  }

  toConnectionOptions(params: { isInteractive?: boolean } = {}): string[] {
    if (params.isInteractive === true) {
      return [...SHARED_CONNECTION_OPTIONS, ...this._toPortOptions(), ...this._toIdentityOptions()]
    }

    return [
      ...SHARED_CONNECTION_OPTIONS,
      ...BACKGROUND_ONLY_CONNECTION_OPTIONS,
      ...this._toPortOptions(),
      ...this._toIdentityOptions(),
    ]
  }

  toTarget(): string {
    if (this._ssh.user === undefined || this._ssh.user === '') {
      return this._ssh.host
    }

    return `${this._ssh.user}@${this._ssh.host}`
  }

  protected _toIdentityOptions(): string[] {
    if (this._ssh.identityFile === undefined) {
      return []
    }

    return ['-i', this._ssh.identityFile]
  }

  protected _toPortOptions(): string[] {
    if (this._ssh.port === undefined) {
      return []
    }

    return ['-p', String(this._ssh.port)]
  }
}
