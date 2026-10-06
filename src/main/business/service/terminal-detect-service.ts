import { basename } from 'node:path'

import { type SettingsRepo } from '#src/main/business/repo/settings-repo'
import { ExecFileUtil } from '#src/main/util/exec-file-util'
import { type ITerminalInfo, type ITerminalListResult } from '#src/shared/api-model'

interface ITerminalCandidate {
  id: string
  name: string
}

const DARWIN_DEFAULT_TERMINAL_ID = 'com.apple.Terminal'

const DARWIN_TERMINALS: ITerminalCandidate[] = [
  { id: 'com.apple.Terminal', name: 'Terminal' },
  { id: 'com.mitchellh.ghostty', name: 'Ghostty' },
  { id: 'com.googlecode.iterm2', name: 'iTerm2' },
  { id: 'net.kovidgoyal.kitty', name: 'kitty' },
  { id: 'org.alacritty', name: 'Alacritty' },
  { id: 'com.github.wez.wezterm', name: 'WezTerm' },
  { id: 'dev.warp.Warp-Stable', name: 'Warp' },
]

const LINUX_TERMINALS: ITerminalCandidate[] = [
  { id: 'ghostty', name: 'Ghostty' },
  { id: 'gnome-terminal', name: 'GNOME Terminal' },
  { id: 'ptyxis', name: 'Ptyxis' },
  { id: 'kitty', name: 'kitty' },
  { id: 'alacritty', name: 'Alacritty' },
  { id: 'wezterm', name: 'WezTerm' },
  { id: 'konsole', name: 'Konsole' },
  { id: 'tilix', name: 'Tilix' },
  { id: 'xterm', name: 'xterm' },
]

const LINUX_TERMINAL_EMULATOR_ALTERNATIVE_PATH = '/etc/alternatives/x-terminal-emulator'

export class TerminalDetectService {
  protected readonly _settingsRepo: SettingsRepo

  constructor(params: { settingsRepo: SettingsRepo }) {
    this._settingsRepo = params.settingsRepo
  }

  async list(): Promise<ITerminalListResult> {
    if (process.platform === 'darwin') {
      return this._listDarwin()
    }

    if (process.platform === 'linux') {
      return this._listLinux()
    }

    return { default: '', detected: [], isSelectedTerminalMissing: false, selected: null }
  }

  protected async _listDarwin(): Promise<ITerminalListResult> {
    const detected = await Promise.all(
      DARWIN_TERMINALS.map((candidate) => {
        return this._toDarwinTerminal({ candidate })
      }),
    )
    const installedTerminals = detected.filter((terminal) => {
      return terminal !== null
    })

    return this._toResult({ defaultId: DARWIN_DEFAULT_TERMINAL_ID, detected: installedTerminals })
  }

  protected async _listLinux(): Promise<ITerminalListResult> {
    const detected = await Promise.all(
      LINUX_TERMINALS.map((candidate) => {
        return this._toLinuxTerminal({ candidate })
      }),
    )
    const installedTerminals = detected.filter((terminal) => {
      return terminal !== null
    })
    const defaultId = await this._toLinuxDefaultId({ detected: installedTerminals })

    return this._toResult({ defaultId, detected: installedTerminals })
  }

  protected _isSelectedTerminalMissing(params: { detectedIds: string[]; savedTerminalId: string | null }): boolean {
    if (params.savedTerminalId === null) {
      return false
    }

    return !params.detectedIds.includes(params.savedTerminalId)
  }

  protected async _toDarwinTerminal(params: { candidate: ITerminalCandidate }): Promise<ITerminalInfo | null> {
    const result = await new ExecFileUtil().toResult({
      args: [`kMDItemCFBundleIdentifier == '${params.candidate.id}'`],
      file: 'mdfind',
    })
    const firstPath = result.stdout.split('\n')[0]?.trim() ?? ''

    if (result.code !== 0 || firstPath === '') {
      return null
    }

    return { id: params.candidate.id, name: params.candidate.name, path: firstPath }
  }

  protected async _toLinuxDefaultId(params: { detected: ITerminalInfo[] }): Promise<string> {
    const result = await new ExecFileUtil().toResult({
      args: ['-f', LINUX_TERMINAL_EMULATOR_ALTERNATIVE_PATH],
      file: 'readlink',
    })
    const knownIds = LINUX_TERMINALS.map((candidate) => {
      return candidate.id
    })
    const resolvedId = basename(result.stdout.trim())

    if (result.code === 0 && knownIds.includes(resolvedId)) {
      return resolvedId
    }

    const firstDetected = params.detected[0]

    if (firstDetected !== undefined) {
      return firstDetected.id
    }

    return ''
  }

  protected async _toLinuxTerminal(params: { candidate: ITerminalCandidate }): Promise<ITerminalInfo | null> {
    const result = await new ExecFileUtil().toResult({ args: [params.candidate.id], file: 'which' })

    if (result.code !== 0) {
      return null
    }

    return { id: params.candidate.id, name: params.candidate.name, path: result.stdout.trim() }
  }

  protected _toResult(params: { defaultId: string; detected: ITerminalInfo[] }): ITerminalListResult {
    const savedTerminalId = this._settingsRepo.getSettings().selectedTerminal
    const detectedIds = params.detected.map((terminal) => {
      return terminal.id
    })

    return {
      default: params.defaultId,
      detected: params.detected,
      isSelectedTerminalMissing: this._isSelectedTerminalMissing({ detectedIds, savedTerminalId }),
      selected: this._toSelectedId({ defaultId: params.defaultId, detectedIds, savedTerminalId }),
    }
  }

  protected _toSelectedId(params: {
    defaultId: string
    detectedIds: string[]
    savedTerminalId: string | null
  }): string | null {
    if (params.savedTerminalId !== null && params.detectedIds.includes(params.savedTerminalId)) {
      return params.savedTerminalId
    }

    if (params.defaultId !== '') {
      return params.defaultId
    }

    return null
  }
}
