import { type ISessionInfo } from '#src/shared/session-model'
import { type TerminalMode } from '#src/shared/terminal-mode-model'

export const terminalModeUtil = {
  toFallbackMode(params: { mode: TerminalMode; sessions: ISessionInfo[] }): TerminalMode | null {
    const { mode, sessions } = params

    if (mode !== 'tmux') {
      return null
    }

    if (sessions.length > 0) {
      return null
    }

    return 'machine'
  },
}
