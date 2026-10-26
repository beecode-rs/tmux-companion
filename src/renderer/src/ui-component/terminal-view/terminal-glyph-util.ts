// Regional indicator letters (the flag alphabet) have no narrow glyph: an
// isolated one renders as a squared letter about 1.7 cells wide while tmux's
// grid allocates it a single column, so the glyph bled under the following
// cell and read as an extra character. Indicator pairs are handled by the
// unicode provider (they join into one two-column flag cell); a lone
// indicator - the remainder of an odd run - is substituted with its ASCII
// letter, which fits a single cell in every terminal font.
const REGIONAL_INDICATOR_FIRST = 0x1f1e6
const REGIONAL_INDICATOR_LAST = 0x1f1ff
const CAPITAL_A_CODE = 0x41

export const terminalGlyphUtil = {
  _isRegionalIndicator(char: string): boolean {
    const codepoint = char.codePointAt(0) ?? 0

    return codepoint >= REGIONAL_INDICATOR_FIRST && codepoint <= REGIONAL_INDICATOR_LAST
  },

  _toIndicatorLetter(char: string): string {
    const codepoint = char.codePointAt(0) ?? REGIONAL_INDICATOR_FIRST

    return String.fromCharCode(CAPITAL_A_CODE + (codepoint - REGIONAL_INDICATOR_FIRST))
  },

  /**
   * Replaces lone regional indicator letters with their ASCII letter, in
   * left-to-right pairing parity: consecutive indicators pair up (and pass
   * through untouched for flag shaping) while an indicator with no partner
   * behind it is substituted.
   */
  toRenderableText(text: string): string {
    // High surrogate shared by every regional indicator (U+1F1E6..U+1F1FF):
    // a cheap prefilter so plain terminal output skips the rewrite entirely.
    if (!text.includes('\ud83c')) {
      return text
    }
    const chars = Array.from(text)
    const state = chars.reduce<{ pendingIndicator: string | null; rendered: string[] }>(
      (state, char) => {
        if (!terminalGlyphUtil._isRegionalIndicator(char)) {
          const pendingIndicator = state.pendingIndicator
          if (pendingIndicator !== null) {
            state.rendered.push(terminalGlyphUtil._toIndicatorLetter(pendingIndicator))
            state.pendingIndicator = null
          }
          state.rendered.push(char)

          return state
        }
        const pendingIndicator = state.pendingIndicator
        if (pendingIndicator === null) {
          state.pendingIndicator = char

          return state
        }
        state.rendered.push(pendingIndicator, char)
        state.pendingIndicator = null

        return state
      },
      { pendingIndicator: null, rendered: [] },
    )
    if (state.pendingIndicator !== null) {
      state.rendered.push(terminalGlyphUtil._toIndicatorLetter(state.pendingIndicator))
    }

    return state.rendered.join('')
  },
}
