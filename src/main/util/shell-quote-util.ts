const SAFE_WORD_PATTERN = /^[A-Za-z0-9_@%+=,.:-]+$/

export const shellQuoteUtil = {
  toShellWord: (value: string): string => {
    if (SAFE_WORD_PATTERN.test(value)) {
      return value
    }

    return `'${value.replaceAll("'", "'\\''")}'`
  },
}
