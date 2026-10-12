import { randomUUID } from 'node:crypto'

import { type SettingsRepo } from '#src/main/business/repo/settings-repo'
import { type SshConnectionService } from '#src/main/business/service/ssh-connection-service'
import { type TmuxService } from '#src/main/business/service/tmux-service'
import { shellHistoryUtil } from '#src/main/util/shell-history-util'
import { instanceLabelUtil } from '#src/shared/instance-label-util'
import {
  type DetectedOs,
  type DetectedShell,
  type IDetectedEnv,
  type IInstance,
  type IInstanceSshConfig,
  type InstanceType,
} from '#src/shared/instance-model'

export class InstanceService {
  protected readonly _settingsRepo: SettingsRepo

  protected readonly _sshConnectionService: SshConnectionService

  protected readonly _tmuxService: TmuxService

  constructor(params: {
    settingsRepo: SettingsRepo
    sshConnectionService: SshConnectionService
    tmuxService: TmuxService
  }) {
    this._settingsRepo = params.settingsRepo
    this._sshConnectionService = params.sshConnectionService
    this._tmuxService = params.tmuxService
  }

  createInstance(params: { label: string; ssh?: IInstanceSshConfig }): IInstance {
    this._assertLabelAvailable({ label: params.label, type: 'ssh' })
    const instance = this._toNewInstance({
      label: params.label,
      ssh: this._toValidSshConfig({ ssh: params.ssh }),
    })
    const instances = this._settingsRepo.getInstances()

    this._settingsRepo.saveInstances({ instances: [...instances, instance] })

    return instance
  }

  async detectInstanceEnv(params: { id: string }): Promise<IInstance> {
    const targetInstance = this._findInstance({
      id: params.id,
      instances: this._settingsRepo.getInstances(),
    })
    const detectedEnv = await this._toDetectedEnv({ instance: targetInstance })

    // Re-read after the probe await and merge into the fresh list: concurrent
    // detections and user edits during the probe must survive this save, so
    // there is no await between the re-read and the save.
    const currentInstances = this._settingsRepo.getInstances()
    const currentInstance = this._findInstance({ id: params.id, instances: currentInstances })
    const nextInstance: IInstance = {
      ...currentInstance,
      ...this._toNextDetectedEnv({ detectedEnv, targetInstance: currentInstance }),
    }
    const nextInstances = currentInstances.map((instance) => {
      if (instance.id !== nextInstance.id) {
        return instance
      }

      return nextInstance
    })

    this._settingsRepo.saveInstances({ instances: nextInstances })

    return nextInstance
  }

  async deleteInstance(params: { id: string; killSessions: boolean }): Promise<void> {
    const instances = this._settingsRepo.getInstances()
    const targetInstance = this._findInstance({ id: params.id, instances })

    if (targetInstance.type === 'local') {
      throw new Error('The local instance cannot be removed')
    }

    if (params.killSessions) {
      await this._killAllSessions({ instance: targetInstance })
    }

    this._settingsRepo.saveInstances({
      instances: instances.filter((instance) => {
        return instance.id !== params.id
      }),
    })
  }

  updateInstance(params: { id: string; label?: string; ssh?: IInstanceSshConfig }): IInstance {
    const instances = this._settingsRepo.getInstances()
    const targetInstance = this._findInstance({ id: params.id, instances })

    this._assertLabelChangeAllowed({ label: params.label, targetInstance })

    const nextInstance = this._toUpdatedInstance({
      targetInstance,
      update: { label: params.label, ssh: params.ssh },
    })
    const nextInstances = instances.map((instance) => {
      if (instance.id !== nextInstance.id) {
        return instance
      }

      return nextInstance
    })

    this._settingsRepo.saveInstances({ instances: nextInstances })

    return nextInstance
  }

  protected _assertLabelAvailable(params: { excludeId?: string; label: string; type: InstanceType }): void {
    const labelError = instanceLabelUtil.resolveLabelError({
      excludeId: params.excludeId,
      instances: this._settingsRepo.getInstances(),
      label: params.label,
      type: params.type,
    })

    if (labelError !== null) {
      throw new Error(labelError)
    }
  }

  protected _assertLabelChangeAllowed(params: { label?: string; targetInstance: IInstance }): void {
    if (
      params.targetInstance.type !== 'local' ||
      params.label === undefined ||
      params.label === params.targetInstance.label
    ) {
      return
    }

    throw new Error('The local instance label cannot be changed')
  }

  protected _findInstance(params: { id: string; instances: IInstance[] }): IInstance {
    const targetInstance = params.instances.find((instance) => {
      return instance.id === params.id
    })

    if (targetInstance === undefined) {
      throw new Error('Instance not found')
    }

    return targetInstance
  }

  protected async _killAllSessions(params: { instance: IInstance }): Promise<void> {
    const sessions = await this._tmuxService.listSessions({ instance: params.instance })

    await Promise.all(
      sessions.map((session) => {
        return this._tmuxService.killSession({ instance: params.instance, name: session.name })
      }),
    )
  }

  protected _toNewInstance(params: { label: string; ssh: IInstanceSshConfig }): IInstance {
    return {
      id: randomUUID(),
      label: params.label,
      ssh: params.ssh,
      type: 'ssh',
    }
  }

  protected async _toDetectedEnv(params: { instance: IInstance }): Promise<IDetectedEnv> {
    if (params.instance.type === 'local') {
      return shellHistoryUtil.toDetectedEnvFromLocal({ env: process.env, platform: process.platform })
    }

    if (params.instance.ssh === undefined) {
      return { detectedOs: 'unknown', detectedShell: 'unknown' }
    }

    return this._sshConnectionService.detectRemoteEnv({ ssh: params.instance.ssh })
  }

  protected _toNextDetectedEnv(params: { detectedEnv: IDetectedEnv; targetInstance: IInstance }): IDetectedEnv {
    return {
      detectedOs: this._toNextDetectedOs({
        next: params.detectedEnv.detectedOs,
        previous: params.targetInstance.detectedOs,
      }),
      detectedShell: this._toNextDetectedShell({
        next: params.detectedEnv.detectedShell,
        previous: params.targetInstance.detectedShell,
      }),
    }
  }

  protected _toNextDetectedOs(params: { next: DetectedOs; previous: DetectedOs | undefined }): DetectedOs {
    if (params.next !== 'unknown') {
      return params.next
    }

    return params.previous ?? 'unknown'
  }

  protected _toNextDetectedShell(params: { next: DetectedShell; previous: DetectedShell | undefined }): DetectedShell {
    if (params.next !== 'unknown') {
      return params.next
    }

    return params.previous ?? 'unknown'
  }

  protected _toNextLabel(params: { label?: string; targetInstance: IInstance }): string {
    if (params.label === undefined) {
      return params.targetInstance.label
    }

    this._assertLabelAvailable({
      excludeId: params.targetInstance.id,
      label: params.label,
      type: params.targetInstance.type,
    })

    return params.label
  }

  protected _toUpdatedInstance(params: {
    targetInstance: IInstance
    update: { label?: string; ssh?: IInstanceSshConfig }
  }): IInstance {
    const nextSshConfig = this._toNextSshConfig({ targetInstance: params.targetInstance, update: params.update })
    const nextInstance: IInstance = {
      ...params.targetInstance,
      label: this._toNextLabel({ label: params.update.label, targetInstance: params.targetInstance }),
    }

    if (nextSshConfig === undefined) {
      return nextInstance
    }

    return { ...nextInstance, ssh: nextSshConfig }
  }

  protected _toNextSshConfig(params: {
    targetInstance: IInstance
    update: { ssh?: IInstanceSshConfig }
  }): IInstanceSshConfig | undefined {
    if (params.update.ssh === undefined) {
      return params.targetInstance.ssh
    }

    if (params.targetInstance.type !== 'ssh') {
      return undefined
    }

    return this._toValidSshConfig({ ssh: params.update.ssh })
  }

  protected _toValidSshConfig(params: { ssh?: IInstanceSshConfig }): IInstanceSshConfig {
    if (params.ssh === undefined || params.ssh.host.trim() === '') {
      throw new Error('SSH instances require a host')
    }

    return params.ssh
  }
}
