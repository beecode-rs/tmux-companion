import { type SettingsRepo } from '#src/main/business/repo/settings-repo'
import { type PtyService } from '#src/main/business/service/pty-service'
import { type IDeepLinkFocusParams } from '#src/shared/deep-link-util'
import { type IInstance } from '#src/shared/instance-model'

const DEFAULT_SSH_PORT = 22

export type IDeepLinkActivateSessionCallback = (params: { instanceId: string }) => void

export type IDeepLinkFocusWindowCallback = () => void

export type IDeepLinkSessionSwitchedCallback = (params: { instanceId: string }) => void

export class DeepLinkService {
  protected readonly _onActivateSession: IDeepLinkActivateSessionCallback

  protected readonly _onFocusWindow: IDeepLinkFocusWindowCallback

  protected readonly _onSessionSwitched: IDeepLinkSessionSwitchedCallback

  protected readonly _ptyService: PtyService

  protected readonly _settingsRepo: SettingsRepo

  constructor(params: {
    onActivateSession: IDeepLinkActivateSessionCallback
    onFocusWindow: IDeepLinkFocusWindowCallback
    onSessionSwitched: IDeepLinkSessionSwitchedCallback
    ptyService: PtyService
    settingsRepo: SettingsRepo
  }) {
    this._onActivateSession = params.onActivateSession
    this._onFocusWindow = params.onFocusWindow
    this._onSessionSwitched = params.onSessionSwitched
    this._ptyService = params.ptyService
    this._settingsRepo = params.settingsRepo
  }

  async handleFocusParams(params: IDeepLinkFocusParams): Promise<void> {
    const instance = this._resolveFocusInstance({ focusParams: params })

    if (instance === undefined) {
      this._onFocusWindow()

      return
    }

    this._onActivateSession({ instanceId: instance.id })

    const isSwitched = await this._ptyService.attachSession({ instance, name: params.sessionName })

    if (isSwitched) {
      this._settingsRepo.setLastSession({ fullSessionName: params.sessionName, instanceId: instance.id })
    }

    this._onSessionSwitched({ instanceId: instance.id })
  }

  protected _resolveFocusInstance(params: { focusParams: IDeepLinkFocusParams }): IInstance | undefined {
    const { focusParams } = params
    const instances = this._settingsRepo.getInstances()

    if (focusParams.host === undefined) {
      return instances.find((instance) => {
        return instance.type === 'local'
      })
    }

    return instances.find((instance) => {
      return this._isSshInstanceTarget({
        host: focusParams.host,
        instance,
        port: focusParams.port,
        user: focusParams.user,
      })
    })
  }

  protected _isSshInstanceTarget(params: {
    host: string | undefined
    instance: IInstance
    port?: number
    user?: string
  }): boolean {
    const { host, instance, port, user } = params

    if (host === undefined || instance.ssh === undefined) {
      return false
    }

    if (instance.ssh.host.toLowerCase() !== host.toLowerCase()) {
      return false
    }

    if (user !== undefined && instance.ssh.user !== user) {
      return false
    }

    return this._toResolvedPort({ port: instance.ssh.port }) === this._toResolvedPort({ port })
  }

  protected _toResolvedPort(params: { port?: number }): number {
    if (params.port === undefined) {
      return DEFAULT_SSH_PORT
    }

    return params.port
  }
}
