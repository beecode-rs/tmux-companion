import { SshExecutor } from '#src/main/exec/ssh-executor'
import { shellHistoryUtil } from '#src/main/util/shell-history-util'
import { shellQuoteUtil } from '#src/main/util/shell-quote-util'
import { type DetectedShell, type IInstance } from '#src/shared/instance-model'

const APPLESCRIPT_TYPING_MARKERS = ['do script', 'write text']

const APPLESCRIPT_TEMPLATE_MARKER = 'osascript'

const APPLESCRIPT_LINEFEED = '" & linefeed & "'

const COMMAND_PLACEHOLDER = '{cmd}'

export const terminalLaunchUtil = {
  _isAppleScriptTemplate(params: { template: string }): boolean {
    return params.template.includes(APPLESCRIPT_TEMPLATE_MARKER)
  },

  _isCmdSingleQuoted(params: { template: string }): boolean {
    const segments = params.template.split("'")

    return segments.some((segment, index) => {
      return index % 2 === 1 && segment.includes(COMMAND_PLACEHOLDER)
    })
  },

  _isShellTypingTemplate(params: { template: string }): boolean {
    return APPLESCRIPT_TYPING_MARKERS.some((marker) => {
      return params.template.includes(marker)
    })
  },

  _toAppleScriptCommand(params: { args: readonly string[]; historySafeShellKind?: DetectedShell }): string {
    const shellCommand = params.args
      .map((arg) => {
        return terminalLaunchUtil._toAppleScriptShellWord({ value: arg })
      })
      .join(' ')

    if (params.historySafeShellKind === undefined) {
      return terminalLaunchUtil._toAppleScriptEscaped({ value: shellCommand })
    }

    const payload = shellHistoryUtil.toHistorySafePayload({
      command: shellCommand,
      shellKind: params.historySafeShellKind,
    })

    return terminalLaunchUtil._toAppleScriptEscaped({ value: payload })
  },

  _toAppleScriptEscaped(params: { value: string }): string {
    return params.value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', APPLESCRIPT_LINEFEED)
  },

  _toAppleScriptShellWord(params: { value: string }): string {
    const shellSafeValue = params.value
      .replaceAll('\\', '\\\\')
      .replaceAll('"', '\\"')
      .replaceAll('$', '\\$')
      .replaceAll('`', '\\`')

    return `"${shellSafeValue}"`
  },

  _toHistorySafeShellKind(params: { shellKind: DetectedShell; template: string }): DetectedShell {
    if (params.shellKind !== 'bash') {
      return params.shellKind
    }

    if (terminalLaunchUtil._isCmdSingleQuoted({ template: params.template })) {
      return params.shellKind
    }

    // The bash enable line carries ${HISTCONTROL:+:$HISTCONTROL}: without
    // single quotes the outer /bin/sh -c would expand it at launch time, so
    // this template degrades to a space prefix only.
    return 'unknown'
  },

  _toShellCommand(params: { args: readonly string[] }): string {
    return params.args
      .map((arg) => {
        return shellQuoteUtil.toShellWord(arg)
      })
      .join(' ')
  },

  _toTemplateCommand(params: { args: readonly string[]; shellKind: DetectedShell; template: string }): string {
    if (!terminalLaunchUtil._isAppleScriptTemplate({ template: params.template })) {
      return terminalLaunchUtil._toShellCommand({ args: params.args })
    }

    if (terminalLaunchUtil._isShellTypingTemplate({ template: params.template })) {
      return terminalLaunchUtil._toAppleScriptCommand({
        args: params.args,
        historySafeShellKind: terminalLaunchUtil._toHistorySafeShellKind({
          shellKind: params.shellKind,
          template: params.template,
        }),
      })
    }

    return terminalLaunchUtil._toAppleScriptCommand({ args: params.args })
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

  toRenderedTemplate(params: { args: readonly string[]; shellKind: DetectedShell; template: string }): string {
    const command = terminalLaunchUtil._toTemplateCommand({
      args: params.args,
      shellKind: params.shellKind,
      template: params.template,
    })

    return params.template.replaceAll(COMMAND_PLACEHOLDER, command)
  },
}
