import { type IExecutor } from '#src/main/exec/executor'
import { ExecFileUtil, type IExecFileResult } from '#src/main/util/exec-file-util'

export class LocalExecutor implements IExecutor {
  run(args: string[]): Promise<IExecFileResult> {
    return new ExecFileUtil().toResult({ args, file: 'tmux' })
  }
}
