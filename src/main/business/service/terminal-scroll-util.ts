import { type TerminalCursorKeys, type TerminalScrollDirection } from '#src/shared/terminal-scroll-model'

export type TerminalScrollPlan =
  | { data: string; type: 'write-arrow-keys' }
  | { direction: TerminalScrollDirection; lines: number; type: 'scroll-after-entering-copy-mode' }
  | { direction: TerminalScrollDirection; lines: number; type: 'scroll-in-copy-mode' }
  | { type: 'exit-copy-mode' }
  | { type: 'ignore' }

export const terminalScrollUtil = {
  _toArrowKey(params: { cursorKeys: TerminalCursorKeys; direction: TerminalScrollDirection }): string {
    if (params.cursorKeys === 'application' && params.direction === 'up') {
      return '\x1bOA'
    }

    if (params.cursorKeys === 'application') {
      return '\x1bOB'
    }

    if (params.direction === 'up') {
      return '\x1b[A'
    }

    return '\x1b[B'
  },

  _toScrollDownPlan(params: { isInCopyMode: boolean; lines: number; scrollPosition: number }): TerminalScrollPlan {
    if (!params.isInCopyMode) {
      return { type: 'ignore' }
    }

    if (params.scrollPosition === 0) {
      return { type: 'exit-copy-mode' }
    }

    return { direction: 'down', lines: Math.min(params.lines, params.scrollPosition), type: 'scroll-in-copy-mode' }
  },

  toArrowKeys(params: { cursorKeys: TerminalCursorKeys; direction: TerminalScrollDirection; lines: number }): string {
    const arrowKey = terminalScrollUtil._toArrowKey({ cursorKeys: params.cursorKeys, direction: params.direction })

    return Array.from({ length: params.lines }, () => {
      return arrowKey
    }).join('')
  },

  toScrollPlan(params: {
    cursorKeys: TerminalCursorKeys
    direction: TerminalScrollDirection
    isAlternateOn: boolean
    isInCopyMode: boolean
    lines: number
    scrollPosition: number
  }): TerminalScrollPlan {
    if (params.isAlternateOn) {
      return {
        data: terminalScrollUtil.toArrowKeys({
          cursorKeys: params.cursorKeys,
          direction: params.direction,
          lines: params.lines,
        }),
        type: 'write-arrow-keys',
      }
    }

    if (params.direction === 'down') {
      return terminalScrollUtil._toScrollDownPlan({
        isInCopyMode: params.isInCopyMode,
        lines: params.lines,
        scrollPosition: params.scrollPosition,
      })
    }

    if (params.isInCopyMode) {
      return { direction: params.direction, lines: params.lines, type: 'scroll-in-copy-mode' }
    }

    return { direction: params.direction, lines: params.lines, type: 'scroll-after-entering-copy-mode' }
  },
}
