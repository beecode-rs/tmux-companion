import { type ReactElement, useEffect, useState } from 'react'

import { ApiClient } from '#src/renderer/src/business/service/api-client'
import { useUpdateStore } from '#src/renderer/src/business/service/update-store'
import { errorMessageUtil } from '#src/renderer/src/util/error-message-util'
import { type ITerminalInfo, type ITerminalListResult } from '#src/shared/api-model'
import { updateUtil } from '#src/shared/update-util'

import '#src/renderer/src/ui-component/app-shell/top-bar.css'

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

export const TopBar = (props: ITopBarProps): ReactElement => {
  const { instanceId, sessionName } = props
  const [actionError, setActionError] = useState<string | null>(null)
  const [selectedTerminalId, setSelectedTerminalId] = useState<string | null>(null)
  const [terminals, setTerminals] = useState<ITerminalListResult | null>(null)
  const {
    downloadPercent,
    downloadUpdate,
    downloadedFilePath,
    error: updateError,
    updateCheck,
    updateFlowState,
  } = useUpdateStore()

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
    const error = actionError ?? updateError

    if (error === null) {
      return null
    }

    return <span className="top-bar-error">{error}</span>
  }

  const renderUpdateButton = (): ReactElement | null => {
    if (!updateCheck?.isUpdateAvailable) {
      return null
    }

    const isUpdateDisabled = updateFlowState === 'downloading'
    const updateButtonLabel = updateUtil.toDownloadButtonLabel({
      downloadPercent,
      latestVersion: updateCheck.latestVersion,
      updateFlowState,
    })
    const updateButtonTitle = updateUtil.toUpdateButtonTitle({
      currentVersion: updateCheck.currentVersion,
      downloadedFilePath,
      latestVersion: updateCheck.latestVersion,
    })

    return (
      <>
        <button
          className="top-bar-update-button"
          disabled={isUpdateDisabled}
          onClick={downloadUpdate}
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
      {renderUpdateButton()}
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
