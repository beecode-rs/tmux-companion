import { type TerminalScrollDirection } from '#src/shared/terminal-scroll-model'

export interface ITerminalScrollbarDragScroll {
  direction: TerminalScrollDirection
  lines: number
}

export interface ITerminalScrollbarGeometry {
  thumbHeightPx: number
  thumbTopPx: number
}

export const terminalScrollbarUtil = {
  _toClamped(params: { max: number; min: number; value: number }): number {
    return Math.min(Math.max(params.value, params.min), params.max)
  },

  toDragScroll(params: { fromPosition: number; toPosition: number }): ITerminalScrollbarDragScroll | null {
    if (params.toPosition === params.fromPosition) {
      return null
    }

    if (params.toPosition > params.fromPosition) {
      return { direction: 'up', lines: params.toPosition - params.fromPosition }
    }

    return { direction: 'down', lines: params.fromPosition - params.toPosition }
  },

  toThumbGeometry(params: {
    historySize: number
    minThumbPx: number
    position: number
    rows: number
    trackHeightPx: number
  }): ITerminalScrollbarGeometry {
    if (params.historySize <= 0 || params.rows <= 0 || params.trackHeightPx <= 0) {
      return { thumbHeightPx: params.trackHeightPx, thumbTopPx: 0 }
    }

    const totalLines = params.historySize + params.rows
    const thumbHeightPx = terminalScrollbarUtil._toClamped({
      max: params.trackHeightPx,
      min: params.minThumbPx,
      value: (params.trackHeightPx * params.rows) / totalLines,
    })
    const clampedPosition = terminalScrollbarUtil._toClamped({
      max: params.historySize,
      min: 0,
      value: params.position,
    })
    const thumbTopPx = (1 - clampedPosition / params.historySize) * (params.trackHeightPx - thumbHeightPx)

    return { thumbHeightPx, thumbTopPx }
  },

  toTrackPosition(params: {
    historySize: number
    pointerTopPx: number
    thumbHeightPx: number
    trackHeightPx: number
  }): number {
    const scrollablePx = params.trackHeightPx - params.thumbHeightPx

    if (params.historySize <= 0 || scrollablePx <= 0) {
      return 0
    }

    const pointerRatio = terminalScrollbarUtil._toClamped({
      max: 1,
      min: 0,
      value: params.pointerTopPx / scrollablePx,
    })

    return Math.round((1 - pointerRatio) * params.historySize)
  },
}
