import { type ExecException, execFile } from 'node:child_process'

export interface IExecFileResult {
  code: number
  stderr: string
  stdout: string
}

export class ExecFileUtil {
  toResult(params: { args: readonly string[]; file: string }): Promise<IExecFileResult> {
    return new Promise<IExecFileResult>((resolve) => {
      execFile(params.file, params.args, { encoding: 'utf8' }, (error, stdout, stderr) => {
        resolve({
          code: this._toExitCode(error),
          stderr: this._toStderr({ error, stderr }),
          stdout,
        })
      })
    })
  }

  protected _toExitCode(error: ExecException | null): number {
    if (error === null) {
      return 0
    }

    if (typeof error.code === 'number') {
      return error.code
    }

    return 1
  }

  protected _toStderr(params: { error: ExecException | null; stderr: string }): string {
    if (params.error === null || params.stderr !== '') {
      return params.stderr
    }

    return params.error.message
  }
}
