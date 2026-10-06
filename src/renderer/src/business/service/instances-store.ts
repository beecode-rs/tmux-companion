import { useSyncExternalStore } from 'react'

import { ApiClient } from '#src/renderer/src/business/service/api-client'
import { type SessionEventsMode } from '#src/shared/api-model'
import { type IInstance } from '#src/shared/instance-model'
import { type ISessionInfo } from '#src/shared/session-model'
import { type IAppSettings } from '#src/shared/settings-model'
import { type TerminalMode } from '#src/shared/terminal-mode-model'
import { terminalModeUtil } from '#src/shared/terminal-mode-util'

const INSTANCES_POLL_INTERVAL_MS = 2000

const SESSIONS_POLL_CONTROL_INTERVAL_MS = 10000

const SESSIONS_POLL_INTERVAL_MS = 2000

export interface ISessionsSnapshot {
  events: SessionEventsMode
  sessions: ISessionInfo[]
}

export type InstanceTerminalRequest = 'disconnect' | 'dispose'

export type IInstanceTerminalController = (params: { instanceId: string; request: InstanceTerminalRequest }) => void

export interface IInstancesStoreApi {
  connectedInstanceIds: string[]
  instances: IInstance[]
  selectedInstanceId: string | null
  settings: IAppSettings | null
  snapshotsByInstanceId: Record<string, ISessionsSnapshot>
  terminalEpoch: number
  terminalMode: TerminalMode
  connectInstance: (params: { instanceId: string }) => void
  disconnectInstance: (params: { instanceId: string }) => Promise<void>
  reloadInstance: (params: { instanceId: string }) => Promise<void>
  registerTerminalController: (controller: IInstanceTerminalController) => () => void
  selectInstance: (instanceId: string) => void
  selectInstanceMachine: (instanceId: string) => void
  handleTmuxExit: (params: { instanceId: string }) => Promise<void>
  refresh: (params: { instanceId: string }) => Promise<ISessionsSnapshot | null>
  refreshInstances: () => Promise<void>
  refreshSettings: () => Promise<void>
  setExpandedInstanceIds: (instanceIds: string[]) => void
  setInstanceConnected: (params: { instanceId: string; isConnected: boolean }) => void
}

interface IInstancesStoreState {
  connectedInstanceIds: string[]
  instances: IInstance[]
  selectedInstanceId: string | null
  settings: IAppSettings | null
  snapshotsByInstanceId: Record<string, ISessionsSnapshot>
  terminalEpoch: number
  terminalMode: TerminalMode
}

class InstancesStore {
  protected readonly _listeners = new Set<() => void>()
  protected _expandedInstanceIds: string[] | null = null
  protected _instancesIntervalId: ReturnType<typeof setInterval> | null = null
  protected _lastSessionsRefreshAtMsByInstanceId = new Map<string, number>()
  protected _polledInstanceIds = new Set<string>()
  protected _sessionsIntervalId: ReturnType<typeof setInterval> | null = null
  protected _state: IInstancesStoreState = {
    connectedInstanceIds: [],
    instances: [],
    selectedInstanceId: null,
    settings: null,
    snapshotsByInstanceId: {},
    terminalEpoch: 0,
    terminalMode: 'tmux',
  }

  protected _terminalController: IInstanceTerminalController | null = null

  protected _unsubscribeSessionsChanged: (() => void) | null = null

  protected _unsubscribeSelectionChanged: (() => void) | null = null

  readonly getSnapshot = (): IInstancesStoreState => {
    return this._state
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener)

    if (this._listeners.size === 1) {
      this._startPolling()
    }

    return () => {
      this._listeners.delete(listener)

      if (this._listeners.size === 0) {
        this._stopPolling()
      }
    }
  }

  readonly refresh = async (params: { instanceId: string }): Promise<ISessionsSnapshot | null> => {
    this._lastSessionsRefreshAtMsByInstanceId.set(params.instanceId, Date.now())

    try {
      const response = await new ApiClient().listSessions({ instanceId: params.instanceId })
      const snapshot: ISessionsSnapshot = { events: response.events, sessions: response.sessions }

      this._setSnapshot({ instanceId: params.instanceId, snapshot })

      return snapshot
    } catch {
      return null
    }
  }

  readonly refreshInstances = async (): Promise<void> => {
    try {
      const response = await new ApiClient().listInstances()

      if (this._isDeepEqual({ next: response.instances, previous: this._state.instances })) {
        return
      }

      const instances = response.instances
      const instanceIds = instances.map((instance) => {
        return instance.id
      })
      const selectedInstanceId = this._toResolvedSelectedInstanceId({ instances })
      const snapshotsByInstanceId = this._toPrunedSnapshots({ instanceIds })

      this._setState({
        connectedInstanceIds: this._toPrunedConnectedInstanceIds({ instanceIds }),
        instances,
        selectedInstanceId,
        snapshotsByInstanceId,
      })
      this._rebuildPolledInstanceIds()
    } catch {
      return
    }
  }

  readonly refreshSettings = async (): Promise<void> => {
    try {
      const settings = await new ApiClient().getSettings()

      if (this._isDeepEqual({ next: settings, previous: this._state.settings })) {
        return
      }

      this._setState({ settings })
    } catch {
      return
    }
  }

  readonly connectInstance = (params: { instanceId: string }): void => {
    this._select({ instanceId: params.instanceId, mode: 'tmux' })
  }

  readonly disconnectInstance = async (params: { instanceId: string }): Promise<void> => {
    this._teardownTerminalSessions({ instanceId: params.instanceId, request: 'disconnect' })
    await new ApiClient().disconnectInstance({ id: params.instanceId })
  }

  readonly reloadInstance = async (params: { instanceId: string }): Promise<void> => {
    this._teardownTerminalSessions({ instanceId: params.instanceId, request: 'dispose' })
    await new ApiClient().disconnectInstance({ id: params.instanceId })
    this._select({ instanceId: params.instanceId, mode: 'tmux' })
  }

  readonly registerTerminalController = (controller: IInstanceTerminalController): (() => void) => {
    this._terminalController = controller

    return () => {
      if (this._terminalController === controller) {
        this._terminalController = null
      }
    }
  }

  readonly selectInstance = (instanceId: string): void => {
    this._select({ instanceId, mode: 'tmux' })
  }

  readonly selectInstanceMachine = (instanceId: string): void => {
    this._select({ instanceId, mode: 'machine' })
  }

  readonly handleTmuxExit = async (params: { instanceId: string }): Promise<void> => {
    if (!this._isSelectedTmuxInstance({ instanceId: params.instanceId })) {
      return
    }

    const snapshot = await this.refresh({ instanceId: params.instanceId })

    if (snapshot === null) {
      return
    }

    if (!this._isSelectedTmuxInstance({ instanceId: params.instanceId })) {
      return
    }

    const fallbackMode = terminalModeUtil.toFallbackMode({ mode: 'tmux', sessions: snapshot.sessions })

    if (fallbackMode === null) {
      return
    }

    this._select({ instanceId: params.instanceId, mode: fallbackMode })
  }

  readonly setExpandedInstanceIds = (instanceIds: string[]): void => {
    const nextIds = [...instanceIds].sort()

    if (this._isDeepEqual({ next: nextIds, previous: this._expandedInstanceIds })) {
      return
    }

    this._expandedInstanceIds = nextIds
    this._rebuildPolledInstanceIds()
  }

  readonly setInstanceConnected = (params: { instanceId: string; isConnected: boolean }): void => {
    const isListed = this._state.connectedInstanceIds.includes(params.instanceId)

    if (params.isConnected === isListed) {
      return
    }

    this._setState({ connectedInstanceIds: this._toNextConnectedInstanceIds(params) })
  }

  protected _handleSelectionChanged(params: { instanceId: string }): void {
    this._select({ instanceId: params.instanceId, mode: 'tmux' })
  }

  protected _select(params: { instanceId: string; mode: TerminalMode }): void {
    const nextTerminalEpoch = this._state.terminalEpoch + 1

    if (this._state.selectedInstanceId === params.instanceId && this._state.terminalMode === params.mode) {
      this._setState({ terminalEpoch: nextTerminalEpoch })

      return
    }

    this._setState({
      selectedInstanceId: params.instanceId,
      terminalEpoch: nextTerminalEpoch,
      terminalMode: params.mode,
    })
    window.tmuxCompanion.setSelectedInstance(params.instanceId)
    this._rebuildPolledInstanceIds()
    void this.refresh({ instanceId: params.instanceId })
  }

  protected _handleSessionsChanged(params: { instanceId: string }): void {
    if (!this._polledInstanceIds.has(params.instanceId)) {
      return
    }

    void this.refresh({ instanceId: params.instanceId })
  }

  protected _isDeepEqual(params: { next: unknown; previous: unknown }): boolean {
    return JSON.stringify(params.next) === JSON.stringify(params.previous)
  }

  protected _isSelectedTmuxInstance(params: { instanceId: string }): boolean {
    return this._state.selectedInstanceId === params.instanceId && this._state.terminalMode === 'tmux'
  }

  protected _pollSessions(): void {
    const nowMs = Date.now()
    const dueInstanceIds = [...this._polledInstanceIds].filter((instanceId) => {
      const lastRefreshedAtMs = this._lastSessionsRefreshAtMsByInstanceId.get(instanceId) ?? 0

      return nowMs - lastRefreshedAtMs >= this._toSessionsPollIntervalMs({ instanceId })
    })

    void Promise.all(
      dueInstanceIds.map((instanceId) => {
        return this.refresh({ instanceId })
      }),
    )
  }

  protected _rebuildPolledInstanceIds(): void {
    const baseIds = this._expandedInstanceIds ?? this._state.instances.map((instance) => instance.id)
    const polledInstanceIds = new Set(baseIds)

    if (this._state.selectedInstanceId !== null) {
      polledInstanceIds.add(this._state.selectedInstanceId)
    }

    this._polledInstanceIds = polledInstanceIds
  }

  protected _setSnapshot(params: { instanceId: string; snapshot: ISessionsSnapshot }): void {
    const previous = this._state.snapshotsByInstanceId[params.instanceId]

    if (previous !== undefined && this._isDeepEqual({ next: params.snapshot, previous })) {
      return
    }

    this._setState({
      snapshotsByInstanceId: { ...this._state.snapshotsByInstanceId, [params.instanceId]: params.snapshot },
    })
  }

  protected _setState(update: Partial<IInstancesStoreState>): void {
    this._state = { ...this._state, ...update }

    this._listeners.forEach((listener) => {
      listener()
    })
  }

  protected _teardownTerminalSessions(params: { instanceId: string; request: InstanceTerminalRequest }): void {
    this._terminalController?.({ instanceId: params.instanceId, request: params.request })
    this.setInstanceConnected({ instanceId: params.instanceId, isConnected: false })
  }

  protected _startPolling(): void {
    void this.refreshInstances()
    void this.refreshSettings()
    this._pollSessions()

    this._unsubscribeSessionsChanged = window.tmuxCompanion.onSessionsChanged((instanceId: string) => {
      this._handleSessionsChanged({ instanceId })
    })

    this._unsubscribeSelectionChanged = window.tmuxCompanion.onSelectionChanged((instanceId: string) => {
      this._handleSelectionChanged({ instanceId })
    })

    this._instancesIntervalId = setInterval(() => {
      void this.refreshInstances()
    }, INSTANCES_POLL_INTERVAL_MS)

    this._sessionsIntervalId = setInterval(() => {
      this._pollSessions()
    }, SESSIONS_POLL_INTERVAL_MS)
  }

  protected _stopPolling(): void {
    if (this._instancesIntervalId !== null) {
      clearInterval(this._instancesIntervalId)
      this._instancesIntervalId = null
    }

    if (this._sessionsIntervalId !== null) {
      clearInterval(this._sessionsIntervalId)
      this._sessionsIntervalId = null
    }

    if (this._unsubscribeSessionsChanged !== null) {
      this._unsubscribeSessionsChanged()
      this._unsubscribeSessionsChanged = null
    }

    if (this._unsubscribeSelectionChanged !== null) {
      this._unsubscribeSelectionChanged()
      this._unsubscribeSelectionChanged = null
    }
  }

  protected _toNextConnectedInstanceIds(params: { instanceId: string; isConnected: boolean }): string[] {
    if (params.isConnected) {
      return [...this._state.connectedInstanceIds, params.instanceId].sort()
    }

    return this._state.connectedInstanceIds.filter((instanceId) => {
      return instanceId !== params.instanceId
    })
  }

  protected _toPrunedConnectedInstanceIds(params: { instanceIds: string[] }): string[] {
    return this._state.connectedInstanceIds.filter((instanceId) => {
      return params.instanceIds.includes(instanceId)
    })
  }

  protected _toPrunedSnapshots(params: { instanceIds: string[] }): Record<string, ISessionsSnapshot> {
    return Object.entries(this._state.snapshotsByInstanceId).reduce<Record<string, ISessionsSnapshot>>(
      (accumulator, [instanceId, snapshot]) => {
        if (!params.instanceIds.includes(instanceId)) {
          return accumulator
        }

        return { ...accumulator, [instanceId]: snapshot }
      },
      {},
    )
  }

  protected _toResolvedSelectedInstanceId(params: { instances: IInstance[] }): string | null {
    const instanceIds = params.instances.map((instance) => instance.id)

    if (this._state.selectedInstanceId !== null && instanceIds.includes(this._state.selectedInstanceId)) {
      return this._state.selectedInstanceId
    }

    const savedInstanceId = window.tmuxCompanion.selectedInstanceId

    if (savedInstanceId !== null && instanceIds.includes(savedInstanceId)) {
      return savedInstanceId
    }

    return instanceIds[0] ?? null
  }

  protected _toSessionsPollIntervalMs(params: { instanceId: string }): number {
    const eventsMode = this._state.snapshotsByInstanceId[params.instanceId]?.events

    if (eventsMode === 'control') {
      return SESSIONS_POLL_CONTROL_INTERVAL_MS
    }

    return SESSIONS_POLL_INTERVAL_MS
  }
}

const instancesStore = new InstancesStore()

export const useInstances = (): IInstancesStoreApi => {
  const state = useSyncExternalStore(instancesStore.subscribe, instancesStore.getSnapshot)

  return {
    connectedInstanceIds: state.connectedInstanceIds,
    connectInstance: instancesStore.connectInstance,
    disconnectInstance: instancesStore.disconnectInstance,
    handleTmuxExit: instancesStore.handleTmuxExit,
    instances: state.instances,
    refresh: instancesStore.refresh,
    refreshInstances: instancesStore.refreshInstances,
    refreshSettings: instancesStore.refreshSettings,
    registerTerminalController: instancesStore.registerTerminalController,
    reloadInstance: instancesStore.reloadInstance,
    selectedInstanceId: state.selectedInstanceId,
    selectInstance: instancesStore.selectInstance,
    selectInstanceMachine: instancesStore.selectInstanceMachine,
    setExpandedInstanceIds: instancesStore.setExpandedInstanceIds,
    setInstanceConnected: instancesStore.setInstanceConnected,
    settings: state.settings,
    snapshotsByInstanceId: state.snapshotsByInstanceId,
    terminalEpoch: state.terminalEpoch,
    terminalMode: state.terminalMode,
  }
}
