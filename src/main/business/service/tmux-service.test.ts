// Supplements: new-session start-path resolution, which needs the executor
// boundary faked (real executors spawn tmux/ssh subprocesses).
import { beforeEach, expect, test, vi } from 'vitest'

import { TmuxService } from '#src/main/business/service/tmux-service'
import { executorFactory, type IExecutor } from '#src/main/exec/executor'
import { type IExecFileResult } from '#src/main/util/exec-file-util'
import { type IInstance } from '#src/shared/instance-model'

const LOCAL_INSTANCE: IInstance = { id: 'i1', label: 'Local', type: 'local' }

const toSuccessResult = (): IExecFileResult => {
  return { code: 0, stderr: '', stdout: '' }
}

class FakeExecutor implements IExecutor {
  readonly runCalls: string[][] = []

  readHomePathCalls = 0

  homePath: string | Error = '/Users/test'

  async readHomePath(): Promise<string> {
    this.readHomePathCalls += 1

    if (this.homePath instanceof Error) {
      throw this.homePath
    }

    return this.homePath
  }

  async run(args: string[]): Promise<IExecFileResult> {
    this.runCalls.push(args)

    return toSuccessResult()
  }
}

const toHarness = (params: { executor: FakeExecutor }): { service: TmuxService } => {
  vi.spyOn(executorFactory, 'create').mockReturnValue(params.executor)

  return { service: new TmuxService() }
}

const toNewSessionArgs = (executor: FakeExecutor): string[] => {
  const args = executor.runCalls[0]

  if (args === undefined) {
    throw new Error('expected the new-session tmux command to run')
  }

  return args
}

beforeEach(() => {
  vi.restoreAllMocks()
})

test('createSession starts a new session in the login user home directory', async () => {
  const executor = new FakeExecutor()
  const { service } = toHarness({ executor })

  const name = await service.createSession({ instance: LOCAL_INSTANCE, name: 's02' })

  expect(name).toBe('s02')
  expect(toNewSessionArgs(executor)).toEqual(['new-session', '-d', '-s', 's02', '-c', '/Users/test'])
})

test('createSession keeps an explicit start path without a home lookup', async () => {
  const executor = new FakeExecutor()
  const { service } = toHarness({ executor })

  await service.createSession({ instance: LOCAL_INSTANCE, name: 's02', startPath: '/srv/app' })

  expect(toNewSessionArgs(executor)).toEqual(['new-session', '-d', '-s', 's02', '-c', '/srv/app'])
  expect(executor.readHomePathCalls).toBe(0)
})

test('createSession trims the resolved home path', async () => {
  const executor = new FakeExecutor()
  executor.homePath = '/home/remote-user\n'
  const { service } = toHarness({ executor })

  await service.createSession({ instance: LOCAL_INSTANCE, name: 's02' })

  expect(toNewSessionArgs(executor)).toEqual(['new-session', '-d', '-s', 's02', '-c', '/home/remote-user'])
})

test('createSession falls back to the tmux server directory when the home lookup fails', async () => {
  const executor = new FakeExecutor()
  executor.homePath = new Error('ssh: connect to host box.io port 22: Operation timed out')
  const { service } = toHarness({ executor })

  await service.createSession({ instance: LOCAL_INSTANCE, name: 's02' })

  expect(toNewSessionArgs(executor)).toEqual(['new-session', '-d', '-s', 's02'])
})

test('createSession falls back to the tmux server directory when the home path resolves empty', async () => {
  const executor = new FakeExecutor()
  executor.homePath = '\n'
  const { service } = toHarness({ executor })

  await service.createSession({ instance: LOCAL_INSTANCE, name: 's02' })

  expect(toNewSessionArgs(executor)).toEqual(['new-session', '-d', '-s', 's02'])
})
