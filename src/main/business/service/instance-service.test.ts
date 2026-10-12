// Supplements: detection round-trip for the app-managed detected fields.
// Covers: InstanceService with constructor-injected deps (electron-store backed
// SettingsRepo cannot run outside Electron), so the store is stubbed here.
import { expect, test } from 'vitest'

import { type SettingsRepo } from '#src/main/business/repo/settings-repo'
import { InstanceService } from '#src/main/business/service/instance-service'
import { type SshConnectionService } from '#src/main/business/service/ssh-connection-service'
import { type TmuxService } from '#src/main/business/service/tmux-service'
import { shellHistoryUtil } from '#src/main/util/shell-history-util'
import { type IDetectedEnv, type IInstance, type IInstanceSshConfig } from '#src/shared/instance-model'

type IDetectEnvHandler = (params: { ssh: IInstanceSshConfig }) => Promise<IDetectedEnv>

class MemorySettingsRepoStub {
  protected instances: IInstance[]

  constructor(instances: IInstance[]) {
    this.instances = instances
  }

  getInstances(): IInstance[] {
    return [...this.instances]
  }

  saveInstances(params: { instances: IInstance[] }): void {
    this.instances = params.instances
  }
}

const toFailedDetection = (): IDetectedEnv => {
  return { detectedOs: 'unknown', detectedShell: 'unknown' }
}

interface IPendingDetection {
  promise: Promise<IDetectedEnv>
  resolve: (env: IDetectedEnv) => void
}

const toPendingDetection = (): IPendingDetection => {
  let resolve: (env: IDetectedEnv) => void = () => undefined
  const promise = new Promise<IDetectedEnv>((res) => {
    resolve = res
  })

  return { promise, resolve }
}

const toService = (params: {
  detectEnv?: IDetectEnvHandler
  instances: IInstance[]
}): { repo: MemorySettingsRepoStub; service: InstanceService } => {
  const repo = new MemorySettingsRepoStub(params.instances)
  const detectEnv: IDetectEnvHandler =
    params.detectEnv ??
    ((_detectParams) => {
      return Promise.resolve(toFailedDetection())
    })
  const sshConnectionService = {
    detectRemoteEnv: (detectParams: { ssh: IInstanceSshConfig }): Promise<IDetectedEnv> => {
      return detectEnv(detectParams)
    },
  } as unknown as SshConnectionService

  return {
    repo,
    service: new InstanceService({
      settingsRepo: repo as unknown as SettingsRepo,
      sshConnectionService,
      tmuxService: {} as unknown as TmuxService,
    }),
  }
}

test('updateInstance keeps app-managed detected fields when the label changes', () => {
  const { service } = toService({
    instances: [
      { detectedOs: 'mac', detectedShell: 'zsh', id: 'i2', label: 'Box', ssh: { host: 'host.io' }, type: 'ssh' },
    ],
  })

  const updated = service.updateInstance({ id: 'i2', label: 'Renamed' })

  expect(updated).toEqual({
    detectedOs: 'mac',
    detectedShell: 'zsh',
    id: 'i2',
    label: 'Renamed',
    ssh: { host: 'host.io' },
    type: 'ssh',
  })
})

test('detectInstanceEnv stores the local platform and shell on the local instance', async () => {
  const { repo, service } = toService({ instances: [{ id: 'local', label: 'Local', type: 'local' }] })

  const instance = await service.detectInstanceEnv({ id: 'local' })

  const expectedEnv = shellHistoryUtil.toDetectedEnvFromLocal({ env: process.env, platform: process.platform })

  expect(instance).toEqual({ ...expectedEnv, id: 'local', label: 'Local', type: 'local' })
  expect(repo.getInstances()).toEqual([instance])
})

test('detectInstanceEnv stores the remote probe result on the ssh instance', async () => {
  const { repo, service } = toService({
    detectEnv: () => {
      return Promise.resolve({ detectedOs: 'linux', detectedShell: 'fish' })
    },
    instances: [{ id: 'i2', label: 'Box', ssh: { host: 'host.io' }, type: 'ssh' }],
  })

  const instance = await service.detectInstanceEnv({ id: 'i2' })

  expect(instance).toEqual({
    detectedOs: 'linux',
    detectedShell: 'fish',
    id: 'i2',
    label: 'Box',
    ssh: { host: 'host.io' },
    type: 'ssh',
  })
  expect(repo.getInstances()).toEqual([instance])
})

test('detectInstanceEnv keeps a known os when the probe reports an unknown os only', async () => {
  const { service } = toService({
    detectEnv: () => {
      return Promise.resolve({ detectedOs: 'unknown', detectedShell: 'fish' })
    },
    instances: [
      { detectedOs: 'mac', detectedShell: 'zsh', id: 'i2', label: 'Box', ssh: { host: 'host.io' }, type: 'ssh' },
    ],
  })

  const instance = await service.detectInstanceEnv({ id: 'i2' })

  expect(instance.detectedOs).toBe('mac')
  expect(instance.detectedShell).toBe('fish')
})

test('detectInstanceEnv keeps previously detected values when the probe fails', async () => {
  const { service } = toService({
    instances: [
      { detectedOs: 'mac', detectedShell: 'zsh', id: 'i2', label: 'Box', ssh: { host: 'unreachable.io' }, type: 'ssh' },
    ],
  })

  const instance = await service.detectInstanceEnv({ id: 'i2' })

  expect(instance.detectedOs).toBe('mac')
  expect(instance.detectedShell).toBe('zsh')
})

test('concurrent detectInstanceEnv calls keep every result and mid-flight user edits', async () => {
  const firstProbe = toPendingDetection()
  const secondProbe = toPendingDetection()
  const { repo, service } = toService({
    detectEnv: (detectParams) => {
      if (detectParams.ssh.host === 'first.io') {
        return firstProbe.promise
      }

      return secondProbe.promise
    },
    instances: [
      { id: 'ia', label: 'First', ssh: { host: 'first.io' }, type: 'ssh' },
      { id: 'ib', label: 'Second', ssh: { host: 'second.io' }, type: 'ssh' },
    ],
  })

  const firstDetection = service.detectInstanceEnv({ id: 'ia' })
  const secondDetection = service.detectInstanceEnv({ id: 'ib' })

  secondProbe.resolve({ detectedOs: 'linux', detectedShell: 'fish' })
  const secondInstance = await secondDetection

  expect(secondInstance).toEqual({
    detectedOs: 'linux',
    detectedShell: 'fish',
    id: 'ib',
    label: 'Second',
    ssh: { host: 'second.io' },
    type: 'ssh',
  })

  service.updateInstance({ id: 'ia', label: 'Renamed' })
  repo.saveInstances({
    instances: repo.getInstances().map((instance) => {
      if (instance.id !== 'ia') {
        return instance
      }

      return { ...instance, lastSession: 'work-b7e1d0' }
    }),
  })

  firstProbe.resolve({ detectedOs: 'mac', detectedShell: 'zsh' })
  const firstInstance = await firstDetection

  expect(firstInstance).toEqual({
    detectedOs: 'mac',
    detectedShell: 'zsh',
    id: 'ia',
    label: 'Renamed',
    lastSession: 'work-b7e1d0',
    ssh: { host: 'first.io' },
    type: 'ssh',
  })
  expect(repo.getInstances()).toEqual([
    {
      detectedOs: 'mac',
      detectedShell: 'zsh',
      id: 'ia',
      label: 'Renamed',
      lastSession: 'work-b7e1d0',
      ssh: { host: 'first.io' },
      type: 'ssh',
    },
    {
      detectedOs: 'linux',
      detectedShell: 'fish',
      id: 'ib',
      label: 'Second',
      ssh: { host: 'second.io' },
      type: 'ssh',
    },
  ])
})
