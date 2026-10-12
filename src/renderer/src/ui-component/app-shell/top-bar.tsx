import { type ReactElement, useEffect, useState } from 'react'

import { ApiClient } from '#src/renderer/src/business/service/api-client'
import { errorMessageUtil } from '#src/renderer/src/util/error-message-util'
import {
  type ITerminalInfo,
  type ITerminalListResult,
  type IUpdateCheckResponse,
  type IUpdateDownloadStatusResponse,
} from '#src/shared/api-model'

import '#src/renderer/src/ui-component/app-shell/top-bar.css'

const UPDATE_DOWNLOAD_STATUS_POLL_INTERVAL_MS = 500

type TopBarUpdateFlowState = 'downloaded' | 'downloading' | 'idle'

interface ITopBarProps {
  instanceId: string | null
  sessionName: string | null
}

const resolveOpenButtonLabel = (params: { terminalName: string | null }): string => {
  if (params.terminalName === null) {
    return 'Open in Terminal'
  }

  return `Open in ${params.terminalName}`
}

const resolveOpenButtonTitle = (params: { sessionName: string | null }): string => {
  if (params.sessionName === null) {
    return 'No active session'
  }

  return `Open session ${params.sessionName} externally`
}

const resolveTerminalName = (params: { terminalId: string | null; terminals: ITerminalInfo[] }): string | null => {
  if (params.terminalId === null) {
    return null
  }

  const terminal = params.terminals.find((candidate) => {
    return candidate.id === params.terminalId
  })

  return terminal?.name ?? null
}

const resolveDownloadPercent = (params: { status: IUpdateDownloadStatusResponse }): number | null => {
  const { status } = params

  if (status.totalBytes <= 0) {
    return null
  }

  return Math.floor((status.receivedBytes / status.totalBytes) * 100)
}

const resolveUpdateButtonLabel = (params: {
  downloadPercent: number | null
  updateFlowState: TopBarUpdateFlowState
  latestVersion: string
}): string => {
  const { downloadPercent, latestVersion, updateFlowState } = params

  if (updateFlowState === 'downloading') {
    if (downloadPercent === null) {
      return 'Downloading…'
    }

    return `Downloading… ${String(downloadPercent)}%`
  }

  if (updateFlowState === 'downloaded') {
    return 'Opened installer'
  }

  return `Download v${latestVersion}`
}

const resolveUpdateButtonTitle = (params: {
  currentVersion: string
  downloadedFilePath: string | null
  latestVersion: string
}): string => {
  const { currentVersion, downloadedFilePath, latestVersion } = params

  if (downloadedFilePath !== null) {
    return `Installer saved to ${downloadedFilePath}`
  }

  return `Version ${latestVersion} available (current ${currentVersion})`
}

export const TopBar = (props: ITopBarProps): ReactElement => {
  const { instanceId, sessionName } = props
  const [actionError, setActionError] = useState<string | null>(null)
  const [selectedTerminalId, setSelectedTerminalId] = useState<string | null>(null)
  const [terminals, setTerminals] = useState<ITerminalListResult | null>(null)
  const [updateCheck, setUpdateCheck] = useState<IUpdateCheckResponse | null>(null)
  const [updateFlowState, setUpdateFlowState] = useState<TopBarUpdateFlowState>('idle')
  const [downloadPercent, setDownloadPercent] = useState<number | null>(null)
  const [downloadedFilePath, setDownloadedFilePath] = useState<string | null>(null)

  useEffect(() => {
    void new ApiClient()
      .listTerminals()
      .then((terminalList) => {
        setTerminals(terminalList)
        setSelectedTerminalId(terminalList.selected)
      })
      .catch((error: unknown) => {
        setActionError(errorMessageUtil.toMessage({ error }))
      })
  }, [])

  useEffect(() => {
    void new ApiClient()
      .checkForUpdate()
      .then((result) => {
        setUpdateCheck(result)
      })
      .catch(() => {
        return undefined
      })
  }, [])

  useEffect(() => {
    if (updateFlowState !== 'downloading') {
      return
    }

    const intervalId = setInterval(() => {
      void new ApiClient()
        .getUpdateDownloadStatus()
        .then((status) => {
          setDownloadPercent(resolveDownloadPercent({ status }))
        })
        .catch(() => {
          return undefined
        })
    }, UPDATE_DOWNLOAD_STATUS_POLL_INTERVAL_MS)

    return () => {
      clearInterval(intervalId)
    }
  }, [updateFlowState])

  const handleChangeTerminal = (terminalId: string): void => {
    setActionError(null)

    void new ApiClient()
      .updateTerminalSetting({ id: terminalId })
      .then((response) => {
        setSelectedTerminalId(response.selected)
      })
      .catch((error: unknown) => {
        setActionError(errorMessageUtil.toMessage({ error }))
      })
  }

  const handleOpenExternal = (): void => {
    if (instanceId === null || sessionName === null) {
      return
    }

    setActionError(null)

    void new ApiClient().openExternalSession({ instanceId, name: sessionName }).catch((error: unknown) => {
      setActionError(errorMessageUtil.toMessage({ error }))
    })
  }

  const handleDownloadUpdate = (): void => {
    if (updateCheck === null) {
      return
    }

    setActionError(null)

    if (updateCheck.asset === null) {
      void window.tmuxCompanion.openExternal(updateCheck.releaseUrl)

      return
    }

    setDownloadPercent(null)
    setUpdateFlowState('downloading')

    void new ApiClient()
      .downloadUpdate()
      .then((result) => {
        setDownloadedFilePath(result.filePath)
        setUpdateFlowState('downloaded')
      })
      .catch((error: unknown) => {
        setUpdateFlowState('idle')
        setActionError(errorMessageUtil.toMessage({ error }))
      })
  }

  const renderNotice = (): ReactElement | null => {
    if (!terminals?.isSelectedTerminalMissing) {
      return null
    }

    return (
      <span className="top-bar-notice" title="The saved terminal is no longer installed; using the default instead">
        Saved terminal not installed — using default
      </span>
    )
  }

  const renderActionError = (): ReactElement | null => {
    if (actionError === null) {
      return null
    }

    return <span className="top-bar-error">{actionError}</span>
  }

  const renderUpdateButton = (): ReactElement | null => {
    if (!updateCheck?.isUpdateAvailable) {
      return null
    }

    const isUpdateDisabled = updateFlowState === 'downloading'
    const updateButtonLabel = resolveUpdateButtonLabel({
      downloadPercent,
      latestVersion: updateCheck.latestVersion,
      updateFlowState,
    })
    const updateButtonTitle = resolveUpdateButtonTitle({
      currentVersion: updateCheck.currentVersion,
      downloadedFilePath,
      latestVersion: updateCheck.latestVersion,
    })

    return (
      <>
        <button
          className="top-bar-update-button"
          disabled={isUpdateDisabled}
          onClick={handleDownloadUpdate}
          title={updateButtonTitle}
          type="button"
        >
          {updateButtonLabel}
        </button>
        <span className="top-bar-separator" />
      </>
    )
  }

  const detectedTerminals = terminals?.detected ?? []
  const selectedTerminalName = resolveTerminalName({ terminalId: selectedTerminalId, terminals: detectedTerminals })
  const isOpenDisabled = instanceId === null || sessionName === null || selectedTerminalId === null
  const openButtonTitle = resolveOpenButtonTitle({ sessionName })

  return (
    <div className="top-bar">
      {renderNotice()}
      <select
        className="top-bar-terminal-select"
        onChange={(event) => {
          handleChangeTerminal(event.target.value)
        }}
        title="External terminal"
        value={selectedTerminalId ?? ''}
      >
        {detectedTerminals.map((terminal) => {
          return (
            <option key={terminal.id} value={terminal.id}>
              {terminal.name}
            </option>
          )
        })}
      </select>
      {renderUpdateButton()}
      <button
        className="top-bar-open-button"
        disabled={isOpenDisabled}
        onClick={handleOpenExternal}
        title={openButtonTitle}
        type="button"
      >
        {resolveOpenButtonLabel({ terminalName: selectedTerminalName })}
      </button>
      {renderActionError()}
    </div>
  )
}
