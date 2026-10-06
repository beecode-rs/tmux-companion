export interface IGetScrollStateFrame {
  type: 'get-scroll-state'
}

export interface IScrollStateFrame {
  historySize: number
  isInCopyMode: boolean
  scrollPosition: number
}

export type TerminalCursorKeys = 'application' | 'normal'

export type TerminalScrollDirection = 'up' | 'down'
