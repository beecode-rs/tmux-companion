import { SshExecutor } from '#src/main/exec/ssh-executor'
import { type IExecFileResult } from '#src/main/util/exec-file-util'
import { shellHistoryUtil } from '#src/main/util/shell-history-util'
import { type ITestConnectionResponse } from '#src/shared/api-model'
import { type IDetectedEnv, type IInstanceSshConfig } from '#src/shared/instance-model'

const DETECT_REMOTE_ENV_TIMEOUT_MS = 20000

const TEST_CONNECTION_TIMEOUT_MS = 20000

export class SshConnectionService {
  async detectRemoteEnv(params: { ssh: IInstanceSshConfig }): Promise<IDetectedEnv> {
    const result = await this._toDetectResult({ ssh: params.ssh })

    if (result?.code !== 0) {
      return { detectedOs: 'unknown', detectedShell: 'unknown' }
    }

    return shellHistoryUtil.toDetectedEnvFromProbeOutput({ stdout: result.stdout })
  }

  async testConnection(params: { ssh: IInstanceSshConfig }): Promise<ITestConnectionResponse> {
    const result = await this._toTestResult({ ssh: params.ssh })

    if (result === null) {
      throw new Error('Connection timed out')
    }

    if (result.code !== 0) {
      throw new Error(this._toFailureMessage({ result }))
    }

    return { message: this._toSuccessMessage({ result }) }
  }

  protected _toDetectResult(params: { ssh: IInstanceSshConfig }): Promise<IExecFileResult | null> {
    const resultPromise = new SshExecutor({ ssh: params.ssh }).runCommand(shellHistoryUtil.toProbeCommandWords())
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => {
        resolve(null)
      }, DETECT_REMOTE_ENV_TIMEOUT_MS)
    })

    return Promise.race([resultPromise, timeoutPromise])
  }

  protected _toFailureMessage(params: { result: IExecFileResult }): string {
    const stderrMessage = params.result.stderr.trim()

    if (stderrMessage !== '') {
      return stderrMessage
    }

    return `Connection failed with exit code ${String(params.result.code)}`
  }

  protected _toSuccessMessage(params: { result: IExecFileResult }): string {
    const tmuxVersion = params.result.stdout.trim()

    if (tmuxVersion === '') {
      return 'Connected'
    }

    return `Connected (${tmuxVersion})`
  }

  protected _toTestResult(params: { ssh: IInstanceSshConfig }): Promise<IExecFileResult | null> {
    const resultPromise = new SshExecutor({ ssh: params.ssh }).run(['-V'])
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => {
        resolve(null)
      }, TEST_CONNECTION_TIMEOUT_MS)
    })

    return Promise.race([resultPromise, timeoutPromise])
  }
}
