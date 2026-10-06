import { type ReactElement, useEffect, useState } from 'react'

import appIconUrl from '#resource/app-icon.png'
import beecodeLogoUrl from '#resource/brand/beecode-logo.png'
import { appTitleUtil } from '#src/shared/app-title-util'

import '#src/renderer/src/ui-component/about/about-page.css'

const APP_TAGLINE = 'Desktop companion for tmux sessions, local and over SSH.'

const APP_TITLE = appTitleUtil.resolve({ isDev: import.meta.env.DEV })

const BEECODE_WEBSITE_URL = 'https://beecode.rs'

const WHAT_IT_DOES_ITEMS = [
  'Instances connect to a machine — local or over SSH — and list every tmux session on it, ready to switch, rename, or kill.',
  'An embedded terminal that runs your real shell inside your real tmux — no wrapper config, nothing rewritten.',
  'An external terminal picker that launches any session in Ghostty, Terminal.app, iTerm2, and friends.',
  'SSH instances through the system ssh binary — your keys, your config aliases, no passwords stored.',
]

const PRIVACY_PARAGRAPH =
  'Everything stays on this machine — settings live in the app’s own data folder, the local API binds to localhost with a per-launch token, and SSH connections go through your own ssh binary. Nothing is telemetry’d anywhere.'

export const AboutPage = (): ReactElement => {
  const [currentVersion, setCurrentVersion] = useState('')

  useEffect(() => {
    const loadCurrentVersion = async (): Promise<void> => {
      try {
        setCurrentVersion(await window.tmuxCompanion.getVersion())
      } catch {
        return
      }
    }

    void loadCurrentVersion()
  }, [])

  const handleOpenBeecodeWebsite = (): void => {
    void window.tmuxCompanion.openExternal(BEECODE_WEBSITE_URL)
  }

  return (
    <div className="about-page">
      <header className="about-page-header">
        <img alt={APP_TITLE} className="about-page-app-icon" src={appIconUrl} />
        <h1 className="about-page-title">{APP_TITLE}</h1>
        <p className="about-page-tagline">{APP_TAGLINE}</p>
      </header>
      <section className="about-page-section">
        <div className="about-page-info-row">
          <span className="about-page-info-label">Version</span>
          {currentVersion !== '' && <span className="about-page-info-value">{currentVersion}</span>}
        </div>
        <div className="about-page-info-row">
          <span className="about-page-info-label">Electron</span>
          <span className="about-page-info-value">{window.tmuxCompanion.electronVersion}</span>
        </div>
      </section>
      <section className="about-page-section">
        <h2 className="about-page-section-title">What it does</h2>
        <ul className="about-page-list">
          {WHAT_IT_DOES_ITEMS.map((item) => {
            return (
              <li className="about-page-list-item" key={item}>
                {item}
              </li>
            )
          })}
        </ul>
      </section>
      <section className="about-page-section">
        <h2 className="about-page-section-title">Privacy</h2>
        <p className="about-page-text">{PRIVACY_PARAGRAPH}</p>
      </section>
      <button className="about-page-made-by" onClick={handleOpenBeecodeWebsite} type="button">
        <img alt="beecode logo" className="about-page-beecode-logo" src={beecodeLogoUrl} />
        <span className="about-page-made-by-text">Made by beecode</span>
        <span className="about-page-beecode-link">beecode.rs</span>
      </button>
    </div>
  )
}
