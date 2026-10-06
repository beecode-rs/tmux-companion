import { type SettingsRepo } from '#src/main/business/repo/settings-repo'
import { type TerminalDetectService } from '#src/main/business/service/terminal-detect-service'
import { terminalLaunchUtil } from '#src/main/business/service/terminal-launch-util'
import { ExecFileUtil, type IExecFileResult } from '#src/main/util/exec-file-util'
import { type ITerminalInfo } from '#src/shared/api-model'
import { type IInstance } from '#src/shared/instance-model'

interface ITerminalLaunchTemplateEntry {
  id: string
  template: string
}

const DARWIN_LAUNCH_TEMPLATES: ITerminalLaunchTemplateEntry[] = [
  {
    id: 'com.apple.Terminal',
    template:
      'osascript -e \'tell application "Terminal" to do script "{cmd}"\' -e \'tell application "Terminal" to activate\'',
  },
  {
    id: 'com.googlecode.iterm2',
    template:
      'osascript -e \'tell application "iTerm2" to create window with default profile command "{cmd}"\' -e \'tell application "iTerm2" to activate\'',
  },
  { id: 'com.github.wez.wezterm', template: 'wezterm start -- {cmd}' },
  { id: 'com.mitchellh.ghostty', template: 'open -na Ghostty --args -e {cmd}' },
  { id: 'dev.warp.Warp-Stable', template: 'open -na Warp --args -e {cmd}' },
  { id: 'net.kovidgoyal.kitty', template: 'open -na kitty --args -e {cmd}' },
  { id: 'org.alacritty', template: 'open -na Alacritty --args -e {cmd}' },
]

const LINUX_LAUNCH_TEMPLATES: ITerminalLaunchTemplateEntry[] = [
  { id: 'alacritty', template: 'alacritty -e {cmd}' },
  { id: 'ghostty', template: 'ghostty -e {cmd}' },
  { id: 'gnome-terminal', template: 'gnome-terminal -- {cmd}' },
  { id: 'kitty', template: 'kitty -e {cmd}' },
  { id: 'konsole', template: 'konsole -e {cmd}' },
  { id: 'ptyxis', template: 'ptyxis -x "{cmd}"' },
  { id: 'tilix', template: 'tilix -e {cmd}' },
  { id: 'wezterm', template: 'wezterm start -- {cmd}' },
  { id: 'xterm', template: 'xterm -e {cmd}' },
]

const LAUNCH_SETTLE_TIMEOUT_MS = 2000

const SHELL_PATH = '/bin/sh'

export class TerminalLaunchService {
  protected readonly _settingsRepo: SettingsRepo

  protected readonly _terminalDetectService: TerminalDetectService

  constructor(params: { settingsRepo: SettingsRepo; terminalDetectService: TerminalDetectService }) {
    this._settingsRepo = params.settingsRepo
    this._terminalDetectService = params.terminalDetectService
  }

  ensureDefaultTemplates(): void {
    const settings = this._settingsRepo.getSettings()

    if (Object.keys(settings.launchTemplates).length !== 0) {
      return
    }

    this._settingsRepo.saveSettings({
      settings: { ...settings, launchTemplates: this.toDefaultTemplates() },
    })
  }

  async openExternal(params: { instance: IInstance; sessionName: string }): Promise<void> {
    const terminalList = await this._terminalDetectService.list()

    if (terminalList.selected === null) {
      throw new Error('No terminal selected and no default terminal detected')
    }

    const terminal = this._toTerminalInfo({ terminalId: terminalList.selected, terminals: terminalList.detected })
    const args = terminalLaunchUtil.toAttachArgs({ instance: params.instance, sessionName: params.sessionName })
    const template = this.toLaunchTemplate({ terminal })
    const renderedTemplate = terminalLaunchUtil.toRenderedTemplate({ args, template })
    const result = await this._toLaunchResult({ renderedTemplate })

    this._assertLaunched({ result })
  }

  toDefaultTemplates(): Record<string, string> {
    return this._toDefaultTemplateEntries().reduce<Record<string, string>>((templates, entry) => {
      return { ...templates, [entry.id]: entry.template }
    }, {})
  }

  toLaunchTemplate(params: { terminal: ITerminalInfo }): string {
    const customTemplate = this._settingsRepo.getSettings().launchTemplates[params.terminal.id]

    if (customTemplate !== undefined) {
      return customTemplate
    }

    const builtinTemplate = this._toDefaultTemplateEntries().find((entry) => {
      return entry.id === params.terminal.id
    })

    if (builtinTemplate !== undefined) {
      return builtinTemplate.template
    }

    return this._toGenericTemplate({ terminal: params.terminal })
  }

  protected _assertLaunched(params: { result: IExecFileResult | null }): void {
    if (params.result === null || params.result.code === 0) {
      return
    }

    const stderrMessage = params.result.stderr.trim()

    if (stderrMessage !== '') {
      throw new Error(stderrMessage)
    }

    throw new Error(`external terminal launch failed with exit code ${String(params.result.code)}`)
  }

  protected _toDefaultTemplateEntries(): ITerminalLaunchTemplateEntry[] {
    if (process.platform === 'linux') {
      return LINUX_LAUNCH_TEMPLATES
    }

    return DARWIN_LAUNCH_TEMPLATES
  }

  protected _toGenericTemplate(params: { terminal: ITerminalInfo }): string {
    if (process.platform === 'linux') {
      return `${params.terminal.id} -e {cmd}`
    }

    return `open -na ${params.terminal.name} --args -e {cmd}`
  }

  protected _toLaunchResult(params: { renderedTemplate: string }): Promise<IExecFileResult | null> {
    const resultPromise = new ExecFileUtil().toResult({ args: ['-c', params.renderedTemplate], file: SHELL_PATH })
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => {
        resolve(null)
      }, LAUNCH_SETTLE_TIMEOUT_MS)
    })

    return Promise.race([resultPromise, timeoutPromise])
  }

  protected _toTerminalInfo(params: { terminalId: string; terminals: ITerminalInfo[] }): ITerminalInfo {
    const detectedTerminal = params.terminals.find((terminal) => {
      return terminal.id === params.terminalId
    })

    if (detectedTerminal !== undefined) {
      return detectedTerminal
    }

    return { id: params.terminalId, name: params.terminalId, path: '' }
  }
}
