import { type ISelectionTextFrame } from '#src/shared/terminal-selection-model'

const TERMINAL_A11Y_TEXTAREA_SELECTOR = '.xterm-helpers textarea'

export const terminalA11ySelectionUtil = {
  _toParsedJson(params: { text: string }): unknown {
    try {
      return JSON.parse(params.text) as unknown
    } catch {
      return null
    }
  },

  applySelectionMirror(params: { text: string; textarea: HTMLTextAreaElement }): void {
    params.textarea.value = params.text
    params.textarea.setSelectionRange(0, params.text.length)
  },

  clearSelectionMirror(params: { textarea: HTMLTextAreaElement }): void {
    if (params.textarea.value === '') {
      return
    }

    params.textarea.value = ''
    params.textarea.setSelectionRange(0, 0)
  },

  registerSelectionMirrorClearing(params: { container: HTMLElement }): void {
    const clearMirroredSelection = (event: Event): void => {
      if (event instanceof KeyboardEvent && event.altKey) {
        return
      }

      const textarea = params.container.querySelector(TERMINAL_A11Y_TEXTAREA_SELECTOR)

      if (textarea === null || !(textarea instanceof HTMLTextAreaElement)) {
        return
      }

      terminalA11ySelectionUtil.clearSelectionMirror({ textarea })
    }

    params.container.addEventListener('beforeinput', clearMirroredSelection, { capture: true })
    params.container.addEventListener('compositionstart', clearMirroredSelection, { capture: true })
    params.container.addEventListener('keydown', clearMirroredSelection, { capture: true })
  },

  toParsedSelectionTextFrame(params: { text: string }): ISelectionTextFrame | null {
    const parsed = terminalA11ySelectionUtil._toParsedJson({ text: params.text })

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null
    }

    const keys = Object.keys(parsed).sort()

    if (keys.length !== 2 || keys[0] !== 'text' || keys[1] !== 'type') {
      return null
    }

    const record = parsed as Record<string, unknown>

    if (record['type'] !== 'selection-text' || typeof record['text'] !== 'string') {
      return null
    }

    return { text: record['text'], type: 'selection-text' }
  },
}
