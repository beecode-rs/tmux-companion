import { type ReactElement, useEffect, useState } from 'react'

import { ApiClient } from '#src/renderer/src/business/service/api-client'
import { errorMessageUtil } from '#src/renderer/src/util/error-message-util'
import { type ILocalNetworkPermissionResponse, type LocalNetworkPermissionStatus } from '#src/shared/api-model'

const MAC_LOCAL_NETWORK_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_LocalNetwork'

const PENDING_STATUS_CLASS_NAME = 'settings-page-permission-status settings-page-permission-status--pending'

const toStatusClassName = (params: { status: LocalNetworkPermissionStatus }): string => {
  if (params.status === 'allowed') {
    return 'settings-page-permission-status settings-page-permission-status--allowed'
  }

  if (params.status === 'blocked') {
    return 'settings-page-permission-status settings-page-permission-status--blocked'
  }

  return PENDING_STATUS_CLASS_NAME
}

const toStatusHint = (params: { status: LocalNetworkPermissionStatus }): string => {
  if (params.status === 'allowed') {
    return 'SSH and other commands launched from this app can reach hosts on your local network.'
  }

  if (params.status === 'blocked') {
    return 'macOS is blocking local network access for this app. Enable Tmux Companion under Privacy & Security > Local Network. If it already appears enabled, turn it off and back on, then check again.'
  }

  if (params.status === 'unprobeable') {
    return 'Could not determine the permission status: no local network interface was found or the check timed out.'
  }

  return 'The permission check is only available on macOS.'
}

const toStatusText = (params: { status: LocalNetworkPermissionStatus }): string => {
  if (params.status === 'allowed') {
    return 'Local network access: allowed'
  }

  if (params.status === 'blocked') {
    return 'Local network access: blocked'
  }

  if (params.status === 'unprobeable') {
    return 'Local network access: unknown'
  }

  return 'Local network access: not available'
}

export const LocalNetworkPermissionSection = (): ReactElement => {
  const [checkResult, setCheckResult] = useState<ILocalNetworkPermissionResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isChecking, setIsChecking] = useState(true)

  const checkPermission = (): void => {
    setError(null)
    setIsChecking(true)

    void new ApiClient()
      .checkLocalNetworkPermission()
      .then((result) => {
        setCheckResult(result)
        setIsChecking(false)
      })
      .catch((checkError: unknown) => {
        setError(errorMessageUtil.toMessage({ error: checkError }))
        setIsChecking(false)
      })
  }

  const handleOpenSettings = (): void => {
    void window.tmuxCompanion.openExternal(MAC_LOCAL_NETWORK_SETTINGS_URL)
  }

  useEffect(() => {
    checkPermission()
  }, [])

  const renderError = (): ReactElement | null => {
    if (error === null) {
      return null
    }

    return <div className="settings-page-error">{error}</div>
  }

  const renderStatus = (): ReactElement => {
    if (isChecking) {
      return <span className={PENDING_STATUS_CLASS_NAME}>Checking…</span>
    }

    if (checkResult === null) {
      return <span className={PENDING_STATUS_CLASS_NAME}>Not checked yet</span>
    }

    return (
      <span className={toStatusClassName({ status: checkResult.status })} title={checkResult.detail ?? undefined}>
        {toStatusText({ status: checkResult.status })}
      </span>
    )
  }

  const renderStatusHint = (): ReactElement | null => {
    if (isChecking || checkResult === null) {
      return null
    }

    return <div className="settings-page-hint">{toStatusHint({ status: checkResult.status })}</div>
  }

  return (
    <section className="settings-page-section">
      <h2 className="settings-page-section-title">macOS permissions</h2>
      <div className="settings-page-hint">
        macOS requires the Local Network permission so SSH and other commands launched from this app can reach hosts on
        your network.
      </div>
      <div className="settings-page-permission-row">
        {renderStatus()}
        <button className="settings-page-check-button" disabled={isChecking} onClick={checkPermission} type="button">
          Check again
        </button>
        <button className="settings-page-check-button" onClick={handleOpenSettings} type="button">
          Open Privacy Settings
        </button>
      </div>
      {renderStatusHint()}
      {renderError()}
    </section>
  )
}
