import { type DetectedOs, type DetectedShell, type IDetectedEnv } from '#src/shared/instance-model'

const BASH_HISTCONTROL_ENABLE_LINE = ' HISTCONTROL=ignorespace${HISTCONTROL:+:$HISTCONTROL}'

const ZSH_HIST_IGNORE_SPACE_ENABLE_LINE = ' setopt HIST_IGNORE_SPACE'

const WINDOWS_UNAME_PREFIXES = ['CYGWIN', 'MINGW', 'MSYS']

export const shellHistoryUtil = {
  toDetectedEnvFromLocal(params: { env: { SHELL?: string }; platform: string }): IDetectedEnv {
    return {
      detectedOs: shellHistoryUtil.toDetectedOsFromPlatform({ platform: params.platform }),
      detectedShell: shellHistoryUtil.toDetectedShellFromPath({ shellPath: params.env.SHELL ?? '' }),
    }
  },

  toDetectedEnvFromProbeOutput(params: { stdout: string }): IDetectedEnv {
    const [unameLine, shellLine] = params.stdout.split('\n')

    return {
      detectedOs: shellHistoryUtil.toDetectedOsFromUname({ unameS: unameLine ?? '' }),
      detectedShell: shellHistoryUtil.toDetectedShellFromPath({ shellPath: shellLine ?? '' }),
    }
  },

  toDetectedOsFromPlatform(params: { platform: string }): DetectedOs {
    if (params.platform === 'darwin') {
      return 'mac'
    }

    if (params.platform === 'linux') {
      return 'linux'
    }

    if (params.platform === 'win32') {
      return 'windows'
    }

    return 'unknown'
  },

  toDetectedOsFromUname(params: { unameS: string }): DetectedOs {
    const unameS = params.unameS.trim()

    if (unameS === 'Darwin') {
      return 'mac'
    }

    if (unameS === 'Linux') {
      return 'linux'
    }

    const isWindowsUname = WINDOWS_UNAME_PREFIXES.some((prefix) => {
      return unameS.startsWith(prefix)
    })

    if (isWindowsUname) {
      return 'windows'
    }

    return 'unknown'
  },

  toDetectedShellFromPath(params: { shellPath: string }): DetectedShell {
    const basename = params.shellPath.trim().split(/[\\/]/).pop() ?? ''

    if (basename === 'zsh') {
      return 'zsh'
    }

    if (basename === 'bash') {
      return 'bash'
    }

    if (basename === 'fish') {
      return 'fish'
    }

    return 'unknown'
  },

  toHistorySafePayload(params: { command: string; shellKind: DetectedShell }): string {
    if (params.shellKind === 'zsh') {
      return `${ZSH_HIST_IGNORE_SPACE_ENABLE_LINE}\n ${params.command}`
    }

    if (params.shellKind === 'bash') {
      return `${BASH_HISTCONTROL_ENABLE_LINE}\n ${params.command}`
    }

    return ` ${params.command}`
  },

  toProbeCommandWords(): string[] {
    return ['sh', '-c', 'uname -s; printf %s "$SHELL"']
  },
}
