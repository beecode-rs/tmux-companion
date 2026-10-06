import { SshExecutor } from '#src/main/exec/ssh-executor'
import { shellQuoteUtil } from '#src/main/util/shell-quote-util'
import { type IInstance } from '#src/shared/instance-model'

const APPLESCRIPT_TEMPLATE_MARKER = 'osascript'

const COMMAND_PLACEHOLDER = '{cmd}'

export const terminalLaunchUtil = {
  _isAppleScriptTemplate(params: { template: string }): boolean {
    return params.template.includes(APPLESCRIPT_TEMPLATE_MARKER)
  },

  _toAppleScriptCommand(params: { args: readonly string[] }): string {
    const shellCommand = params.args
      .map((arg) => {
        return terminalLaunchUtil._toAppleScriptShellWord({ value: arg })
      })
      .join(' ')

    return terminalLaunchUtil._toAppleScriptEscaped({ value: shellCommand })
  },

  _toAppleScriptEscaped(params: { value: string }): string {
    return params.value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  },

  _toAppleScriptShellWord(params: { value: string }): string {
    const shellSafeValue = params.value
      .replaceAll('\\', '\\\\')
      .replaceAll('"', '\\"')
      .replaceAll('$', '\\$')
      .replaceAll('`', '\\`')

    return `"${shellSafeValue}"`
  },

  _toShellCommand(params: { args: readonly string[] }): string {
    return params.args
      .map((arg) => {
        return shellQuoteUtil.toShellWord(arg)
      })
      .join(' ')
  },

  _toTemplateCommand(params: { args: readonly string[]; template: string }): string {
    if (terminalLaunchUtil._isAppleScriptTemplate({ template: params.template })) {
      return terminalLaunchUtil._toAppleScriptCommand({ args: params.args })
    }

    return terminalLaunchUtil._toShellCommand({ args: params.args })
  },

  toAttachArgs(params: { instance: IInstance; sessionName: string }): string[] {
    if (params.instance.type === 'local') {
      return ['tmux', 'attach', '-t', `=${params.sessionName}`]
    }

    if (params.instance.ssh === undefined) {
      throw new Error(`Instance '${params.instance.label}' is missing ssh configuration`)
    }

    const sshExecutor = new SshExecutor({ ssh: params.instance.ssh })

    return [
      'ssh',
      ...sshExecutor.toConnectionOptions({ isInteractive: true }),
      '-t',
      sshExecutor.toTarget(),
      '--',
      ...sshExecutor.toTmuxCommandWords({ args: ['attach', '-t', `=${params.sessionName}`] }),
    ]
  },

  toRenderedTemplate(params: { args: readonly string[]; template: string }): string {
    const command = terminalLaunchUtil._toTemplateCommand({ args: params.args, template: params.template })

    return params.template.replaceAll(COMMAND_PLACEHOLDER, command)
  },
}
