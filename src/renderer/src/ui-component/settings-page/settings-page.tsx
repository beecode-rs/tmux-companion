import { type ReactElement, useEffect, useState } from 'react'

import { ApiClient } from '#src/renderer/src/business/service/api-client'
import { useInstances } from '#src/renderer/src/business/service/instances-store'
import { errorMessageUtil } from '#src/renderer/src/util/error-message-util'
import { type ITerminalInfo, type IUpdateSettingsRequest } from '#src/shared/api-model'
import { appTitleUtil } from '#src/shared/app-title-util'
import { type IAppSettings } from '#src/shared/settings-model'

import '#src/renderer/src/ui-component/settings-page/settings-page.css'

interface ISettingsPageProps {
  onOpenAbout: () => void
}

const APP_TITLE = appTitleUtil.resolve({ isDev: import.meta.env.DEV })

const HOTKEY_DEFAULT_HINT = 'default: CommandOrControl+Alt+T'

const toTemplateEntries = (params: {
  launchTemplates: Record<string, string>
  terminalId: string
  value: string
}): [string, string][] => {
  const otherEntries = Object.entries(params.launchTemplates).filter(([terminalId]) => {
    return terminalId !== params.terminalId
  })

  if (params.value === '') {
    return otherEntries
  }

  return [...otherEntries, [params.terminalId, params.value]]
}

export const SettingsPage = (props: ISettingsPageProps): ReactElement => {
  const { onOpenAbout } = props
  const { refreshSettings, settings: storedSettings } = useInstances()
  const [draftSettings, setDraftSettings] = useState<IAppSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [terminals, setTerminals] = useState<ITerminalInfo[]>([])

  useEffect(() => {
    if (draftSettings !== null || storedSettings === null) {
      return
    }

    setDraftSettings(storedSettings)
  }, [draftSettings, storedSettings])

  useEffect(() => {
    void new ApiClient()
      .listTerminals()
      .then((terminalList) => {
        setTerminals(terminalList.detected)
      })
      .catch((loadError: unknown) => {
        setError(errorMessageUtil.toMessage({ error: loadError }))
      })
  }, [])

  const updateSettings = (update: IUpdateSettingsRequest): void => {
    setError(null)
    setDraftSettings((previous) => {
      if (previous === null) {
        return null
      }

      return { ...previous, ...update }
    })

    void new ApiClient()
      .updateSettings(update)
      .then(() => {
        void refreshSettings()
      })
      .catch((saveError: unknown) => {
        setError(errorMessageUtil.toMessage({ error: saveError }))
      })
  }

  const handleToggleConfirmBeforeKill = (): void => {
    if (draftSettings === null) {
      return
    }

    updateSettings({ confirmBeforeKill: !draftSettings.confirmBeforeKill })
  }

  const handleToggleGhosttyThemeImport = (): void => {
    if (draftSettings === null) {
      return
    }

    updateSettings({ ghosttyThemeImport: !draftSettings.ghosttyThemeImport })
  }

  const handleToggleHotkeyEnabled = (): void => {
    if (draftSettings === null) {
      return
    }

    updateSettings({ hotkeyEnabled: !draftSettings.hotkeyEnabled })
  }

  const handleHotkeyAcceleratorChange = (params: { value: string }): void => {
    if (params.value.trim() === '') {
      return
    }

    updateSettings({ hotkeyAccelerator: params.value })
  }

  const handleTemplateChange = (params: { terminalId: string; value: string }): void => {
    if (draftSettings === null) {
      return
    }

    const launchTemplates = Object.fromEntries(
      toTemplateEntries({
        launchTemplates: draftSettings.launchTemplates,
        terminalId: params.terminalId,
        value: params.value,
      }),
    )

    updateSettings({ launchTemplates })
  }

  const renderError = (): ReactElement | null => {
    if (error === null) {
      return null
    }

    return <div className="settings-page-error">{error}</div>
  }

  const renderTemplateRow = (terminal: ITerminalInfo): ReactElement => {
    const template = draftSettings?.launchTemplates[terminal.id] ?? ''

    return (
      <div className="settings-page-template-row" key={terminal.id}>
        <span className="settings-page-template-name" title={terminal.id}>
          {terminal.name}
        </span>
        <input
          className="settings-page-template-input"
          onChange={(event) => {
            handleTemplateChange({ terminalId: terminal.id, value: event.target.value })
          }}
          placeholder="default template"
          title={terminal.id}
          value={template}
        />
      </div>
    )
  }

  const renderTemplateRows = (): ReactElement | ReactElement[] | null => {
    if (terminals.length === 0) {
      return <div className="settings-page-hint">No external terminals detected</div>
    }

    return terminals.map((terminal) => {
      return renderTemplateRow(terminal)
    })
  }

  if (draftSettings === null) {
    return (
      <div className="settings-page">
        <div className="settings-page-hint">Loading settings…</div>
        {renderError()}
      </div>
    )
  }

  return (
    <div className="settings-page">
      <section className="settings-page-section">
        <h2 className="settings-page-section-title">General</h2>
        <label className="settings-page-toggle">
          <input checked={draftSettings.confirmBeforeKill} onChange={handleToggleConfirmBeforeKill} type="checkbox" />
          <span>Confirm before killing a session</span>
        </label>
      </section>
      <section className="settings-page-section">
        <h2 className="settings-page-section-title">External terminal launch templates</h2>
        <div className="settings-page-hint">
          Command template per terminal; {'{cmd}'} is replaced by the attach command. Empty uses the built-in default.
        </div>
        {renderTemplateRows()}
      </section>
      <section className="settings-page-section">
        <h2 className="settings-page-section-title">Global hotkey</h2>
        <label className="settings-page-toggle">
          <input checked={draftSettings.hotkeyEnabled} onChange={handleToggleHotkeyEnabled} type="checkbox" />
          <span>Enable global hotkey</span>
        </label>
        <label className="settings-page-field">
          <span className="settings-page-field-label">Accelerator ({HOTKEY_DEFAULT_HINT})</span>
          <input
            className="settings-page-input"
            onChange={(event) => {
              handleHotkeyAcceleratorChange({ value: event.target.value })
            }}
            value={draftSettings.hotkeyAccelerator}
          />
        </label>
      </section>
      <section className="settings-page-section">
        <h2 className="settings-page-section-title">Appearance</h2>
        <label className="settings-page-toggle">
          <input checked={draftSettings.ghosttyThemeImport} onChange={handleToggleGhosttyThemeImport} type="checkbox" />
          <span>Import theme from the Ghostty config</span>
        </label>
      </section>
      <section className="settings-page-section">
        <button className="settings-page-about-button" onClick={onOpenAbout} type="button">
          About {APP_TITLE}
        </button>
      </section>
      {renderError()}
    </div>
  )
}
