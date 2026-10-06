import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { type SettingsRepo } from '#src/main/business/repo/settings-repo'
import { ghosttyThemeUtil } from '#src/main/business/service/ghostty-theme-util'
import { type IGetThemeResponse } from '#src/shared/api-model'

export class GhosttyThemeService {
  protected readonly _configPaths: string[]

  protected readonly _settingsRepo: SettingsRepo

  constructor(params: { settingsRepo: SettingsRepo }) {
    this._configPaths = [
      join(homedir(), '.config', 'ghostty', 'config'),
      join(homedir(), 'Library', 'Application Support', 'com.mitchellh.ghostty', 'config'),
    ]
    this._settingsRepo = params.settingsRepo
  }

  getTheme(): IGetThemeResponse | null {
    const settings = this._settingsRepo.getSettings()

    if (!settings.ghosttyThemeImport) {
      return null
    }

    const configContent = this._toConfigContent()

    if (configContent === null) {
      return null
    }

    return ghosttyThemeUtil.parseConfig({ content: configContent })
  }

  protected _toConfigContent(): string | null {
    const configPath = this._configPaths.find((candidatePath) => {
      return existsSync(candidatePath)
    })

    if (configPath === undefined) {
      return null
    }

    try {
      return readFileSync(configPath, 'utf8')
    } catch {
      return null
    }
  }
}
