import { LocalExecutor } from '#src/main/exec/local-executor'
import { SshExecutor } from '#src/main/exec/ssh-executor'
import { type IExecFileResult } from '#src/main/util/exec-file-util'
import { type IInstance } from '#src/shared/instance-model'

export interface IExecutor {
  run: (args: string[]) => Promise<IExecFileResult>
}

export const executorFactory = {
  create: (params: { instance: IInstance }): IExecutor => {
    if (params.instance.type === 'ssh') {
      if (params.instance.ssh === undefined) {
        throw new Error(`Instance '${params.instance.label}' is missing ssh configuration`)
      }

      return new SshExecutor({ ssh: params.instance.ssh })
    }

    return new LocalExecutor()
  },
}
