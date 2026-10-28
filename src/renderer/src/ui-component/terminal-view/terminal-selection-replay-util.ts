import { type Terminal } from '@xterm/xterm'

export interface ISelectionReplayPoint {
  x: number
  y: number
}

export const terminalSelectionReplayUtil = {
  /**
   * Re-runs a pane-swallowed drag as xterm's modifier-forced selection
   * gesture. mousedown starts the forced selection, the follow-up move/up
   * listeners live on the document — the same path a real Option-drag takes,
   * so the terminal ends up owning a real selection (highlight, getSelection)
   * that onSelectionChange can mirror for assistive tech.
   */
  replayForcedSelection(params: { from: ISelectionReplayPoint; terminal: Terminal; to: ISelectionReplayPoint }): void {
    const element = params.terminal.element

    if (element === undefined) {
      return
    }

    const document = element.ownerDocument
    const modifiers = terminalSelectionReplayUtil.toForcedSelectionModifiers({
      isMac: navigator.userAgent.includes('Mac'),
    })

    const toEventInit = (point: ISelectionReplayPoint): MouseEventInit => {
      return {
        ...modifiers,
        bubbles: true,
        button: 0,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
        detail: 1,
      }
    }

    element.dispatchEvent(new MouseEvent('mousedown', toEventInit(params.from)))
    document.dispatchEvent(new MouseEvent('mousemove', toEventInit(params.to)))
    document.dispatchEvent(new MouseEvent('mouseup', toEventInit(params.to)))
  },

  /**
   * The modifier xterm's SelectionService treats as "force selection even in
   * mouse-reporting mode" (mac: Option via macOptionClickForcesSelection,
   * elsewhere: Shift). On mac this must not turn into column select —
   * shouldColumnSelect exempts exactly this combination.
   */
  toForcedSelectionModifiers(params: { isMac: boolean }): { altKey: boolean; shiftKey: boolean } {
    if (params.isMac) {
      return { altKey: true, shiftKey: false }
    }

    return { altKey: false, shiftKey: true }
  },
}
