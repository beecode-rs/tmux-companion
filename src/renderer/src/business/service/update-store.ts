import { useSyncExternalStore } from 'react'

import { ApiClient } from '#src/renderer/src/business/service/api-client'
import { errorMessageUtil } from '#src/renderer/src/util/error-message-util'
import {
  type IUpdateCheckFailure,
  type IUpdateCheckResponse,
  type IUpdateDownloadStatusResponse,
  type UpdateFlowState,
} from '#src/shared/api-model'
import { updateUtil } from '#src/shared/update-util'

const UPDATE_DOWNLOAD_STATUS_POLL_INTERVAL_MS = 500

export interface IUpdateStoreApi {
  downloadPercent: number | null
  downloadedFilePath: string | null
  error: string | null
  updateCheck: IUpdateCheckResponse | null
  updateCheckFailure: IUpdateCheckFailure | null
  updateFlowState: UpdateFlowState
  downloadUpdate: () => void
  refreshUpdateCheck: () => Promise<void>
  restartForUpdate: () => void
}

interface IUpdateStoreState {
  downloadPercent: number | null
  downloadedFilePath: string | null
  error: string | null
  updateCheck: IUpdateCheckResponse | null
  updateCheckFailure: IUpdateCheckFailure | null
  updateFlowState: UpdateFlowState
}

const toDownloadPercent = (params: { status: IUpdateDownloadStatusResponse }): number | null => {
  const { status } = params

  if (status.totalBytes <= 0) {
    return null
  }

  return Math.floor((status.receivedBytes / status.totalBytes) * 100)
}

class UpdateStore {
  protected readonly _listeners = new Set<() => void>()

  protected _statusEpoch = 0

  protected _statusIntervalId: ReturnType<typeof setInterval> | null = null

  protected _state: IUpdateStoreState = {
    downloadedFilePath: null,
    downloadPercent: null,
    error: null,
    updateCheck: null,
    updateCheckFailure: null,
    updateFlowState: 'idle',
  }

  readonly getSnapshot = (): IUpdateStoreState => {
    return this._state
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener)

    if (this._listeners.size === 1) {
      void this.refreshUpdateCheck()
    }

    return () => {
      this._listeners.delete(listener)

      if (this._listeners.size === 0) {
        this._stopStatusPolling()
      }
    }
  }

  readonly refreshUpdateCheck = async (): Promise<void> => {
    const updateCheckResult = await new ApiClient().checkForUpdate()

    if (updateCheckResult.status === 'failed') {
      this._setState({ updateCheckFailure: updateCheckResult.failure })

      return
    }

    this._setState({ error: null, updateCheck: updateCheckResult.updateCheck, updateCheckFailure: null })
  }

  readonly downloadUpdate = (): void => {
    const { updateCheck } = this._state

    if (updateCheck === null) {
      return
    }

    if (updateCheck.asset === null) {
      void window.tmuxCompanion.openExternal(updateCheck.releaseUrl)

      return
    }

    this._setState({ downloadPercent: null, error: null, updateFlowState: 'downloading' })
    this._startStatusPolling()

    void new ApiClient()
      .downloadUpdate()
      .then((result) => {
        this._setState({
          downloadedFilePath: result.filePath,
          updateFlowState: updateUtil.toUpdateFlowState({ status: result.status }),
        })
        this._stopStatusPolling()
      })
      .catch((error: unknown) => {
        this._setState({ error: errorMessageUtil.toMessage({ error }), updateFlowState: 'idle' })
        this._stopStatusPolling()
      })
  }

  readonly restartForUpdate = (): void => {
    void new ApiClient().restartUpdate().catch(() => {
      return undefined
    })
  }

  protected _applyDownloadStatus(params: { status: IUpdateDownloadStatusResponse }): void {
    const { status } = params
    const updateFlowState = updateUtil.toUpdateFlowState({ status: status.status })
    const downloadPercent = toDownloadPercent({ status })
    const isServerDrivenFlowState =
      updateFlowState === 'downloaded' || updateFlowState === 'installing' || updateFlowState === 'restart-required'

    if (!isServerDrivenFlowState) {
      if (downloadPercent !== this._state.downloadPercent) {
        this._setState({ downloadPercent })
      }

      return
    }

    if (downloadPercent === this._state.downloadPercent && updateFlowState === this._state.updateFlowState) {
      return
    }

    this._setState({ downloadPercent, updateFlowState })
  }

  protected _invalidatePendingStatusRefresh(): void {
    this._statusEpoch += 1
  }

  protected _refreshDownloadStatus(): void {
    const statusEpoch = this._statusEpoch

    void new ApiClient()
      .getUpdateDownloadStatus()
      .then((status) => {
        if (statusEpoch !== this._statusEpoch) {
          return
        }

        this._applyDownloadStatus({ status })
      })
      .catch(() => {
        return
      })
  }

  protected _setState(update: Partial<IUpdateStoreState>): void {
    this._state = { ...this._state, ...update }

    this._listeners.forEach((listener) => {
      listener()
    })
  }

  protected _startStatusPolling(): void {
    if (this._statusIntervalId !== null) {
      return
    }

    this._statusIntervalId = setInterval(() => {
      this._refreshDownloadStatus()
    }, UPDATE_DOWNLOAD_STATUS_POLL_INTERVAL_MS)
  }

  protected _stopStatusPolling(): void {
    if (this._statusIntervalId === null) {
      return
    }

    this._invalidatePendingStatusRefresh()
    clearInterval(this._statusIntervalId)
    this._statusIntervalId = null
  }
}

const updateStore = new UpdateStore()

export const useUpdateStore = (): IUpdateStoreApi => {
  const state = useSyncExternalStore(updateStore.subscribe, updateStore.getSnapshot)

  return {
    downloadedFilePath: state.downloadedFilePath,
    downloadPercent: state.downloadPercent,
    downloadUpdate: updateStore.downloadUpdate,
    error: state.error,
    refreshUpdateCheck: updateStore.refreshUpdateCheck,
    restartForUpdate: updateStore.restartForUpdate,
    updateCheck: state.updateCheck,
    updateCheckFailure: state.updateCheckFailure,
    updateFlowState: state.updateFlowState,
  }
}
