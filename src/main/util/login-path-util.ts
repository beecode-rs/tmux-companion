import { ExecFileUtil } from '#src/main/util/exec-file-util'

const FALLBACK_SHELL = '/bin/zsh'

export class LoginPathUtil {
  protected _cachedPath: string | null = null

  async resolve(): Promise<string> {
    if (this._cachedPath !== null) {
      return this._cachedPath
    }

    if (process.platform !== 'darwin') {
      return process.env.PATH ?? ''
    }

    const loginPath = await this._resolveDarwinLoginPath()

    if (loginPath === null) {
      return process.env.PATH ?? ''
    }

    this._cachedPath = loginPath

    return loginPath
  }

  async applyToProcessEnv(): Promise<void> {
    const path = await this.resolve()

    if (path === '') {
      return
    }

    process.env.PATH = path
  }

  protected async _resolveDarwinLoginPath(): Promise<string | null> {
    const shell = process.env.SHELL ?? FALLBACK_SHELL
    const result = await new ExecFileUtil().toResult({ args: ['-ilc', 'echo $PATH'], file: shell })

    if (result.code !== 0) {
      return null
    }

    return this._toLastNonEmptyLine({ stdout: result.stdout })
  }

  protected _toLastNonEmptyLine(params: { stdout: string }): string | null {
    const lines = params.stdout
      .split('\n')
      .map((line) => {
        return line.trim()
      })
      .filter((line) => {
        return line !== ''
      })

    return lines[lines.length - 1] ?? null
  }
}
