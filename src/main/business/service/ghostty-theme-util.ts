import { type IGetThemeResponse, type IThemeColors } from '#src/shared/api-model'

interface IParsedConfigLine {
  key: string
  value: string
}

interface IColorKeyEntry {
  configKey: string
  themeKey: keyof IThemeColors
}

const COLOR_KEY_ENTRIES: IColorKeyEntry[] = [
  { configKey: 'background', themeKey: 'background' },
  { configKey: 'cursor-color', themeKey: 'cursor' },
  { configKey: 'foreground', themeKey: 'foreground' },
  { configKey: 'selection-background', themeKey: 'selectionBackground' },
  { configKey: 'selection-foreground', themeKey: 'selectionForeground' },
]

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

const KNOWN_CONFIG_KEYS: string[] = [
  'font-family',
  'font-size',
  ...COLOR_KEY_ENTRIES.map((entry) => {
    return entry.configKey
  }),
]

export const ghosttyThemeUtil = {
  _toColorThemeKey(params: { key: string }): keyof IThemeColors | undefined {
    const entry = COLOR_KEY_ENTRIES.find((colorKeyEntry) => {
      return colorKeyEntry.configKey === params.key
    })

    if (entry === undefined) {
      return undefined
    }

    return entry.themeKey
  },

  _toFontFamilySpread(params: { fontFamilies: string[] }): { fontFamily?: string } {
    if (params.fontFamilies.length === 0) {
      return {}
    }

    return { fontFamily: params.fontFamilies.join(', ') }
  },

  _toFontSize(params: { value: string }): number | undefined {
    const parsedSize = Number(params.value)

    if (!Number.isFinite(parsedSize) || parsedSize <= 0) {
      return undefined
    }

    return parsedSize
  },

  _toFontSizeSpread(params: { parsedLines: IParsedConfigLine[] }): { fontSize?: number } {
    const fontSize = ghosttyThemeUtil._toParsedFontSize({ parsedLines: params.parsedLines })

    if (fontSize === undefined) {
      return {}
    }

    return { fontSize }
  },

  _toParsedFontSize(params: { parsedLines: IParsedConfigLine[] }): number | undefined {
    const fontSizeLine = params.parsedLines.find((parsedLine) => {
      return parsedLine.key === 'font-size'
    })

    if (fontSizeLine === undefined) {
      return undefined
    }

    return ghosttyThemeUtil._toFontSize({ value: fontSizeLine.value })
  },

  _toParsedLine(params: { line: string }): IParsedConfigLine | null {
    const trimmedLine = params.line.trim()

    if (trimmedLine === '' || trimmedLine.startsWith('#')) {
      return null
    }

    const separatorIndex = trimmedLine.indexOf('=')

    if (separatorIndex < 1) {
      return null
    }

    const key = trimmedLine.slice(0, separatorIndex).trim()
    const value = trimmedLine.slice(separatorIndex + 1).trim()

    if (!KNOWN_CONFIG_KEYS.includes(key) || value === '') {
      return null
    }

    return { key, value }
  },

  _toTheme(params: { parsedLines: IParsedConfigLine[] }): IThemeColors {
    return params.parsedLines.reduce<IThemeColors>((accumulator, parsedLine) => {
      const themeKey = ghosttyThemeUtil._toColorThemeKey({ key: parsedLine.key })

      if (themeKey === undefined) {
        return accumulator
      }

      const cssColor = ghosttyThemeUtil.toCssColor({ value: parsedLine.value })

      if (cssColor === null) {
        return accumulator
      }

      return { ...accumulator, [themeKey]: cssColor }
    }, {})
  },

  _toThemeSpread(params: { parsedLines: IParsedConfigLine[] }): { theme?: IThemeColors } {
    const theme = ghosttyThemeUtil._toTheme({ parsedLines: params.parsedLines })

    if (Object.keys(theme).length === 0) {
      return {}
    }

    return { theme }
  },

  parseConfig(params: { content: string }): IGetThemeResponse {
    const parsedLines = params.content
      .split('\n')
      .map((line) => {
        return ghosttyThemeUtil._toParsedLine({ line })
      })
      .filter((parsedLine): parsedLine is IParsedConfigLine => {
        return parsedLine !== null
      })
    const fontFamilies = parsedLines
      .filter((parsedLine) => {
        return parsedLine.key === 'font-family'
      })
      .map((parsedLine) => {
        return parsedLine.value
      })

    return {
      ...ghosttyThemeUtil._toFontFamilySpread({ fontFamilies }),
      ...ghosttyThemeUtil._toFontSizeSpread({ parsedLines }),
      ...ghosttyThemeUtil._toThemeSpread({ parsedLines }),
    }
  },

  toCssColor(params: { value: string }): string | null {
    const trimmedValue = params.value.trim()

    if (!HEX_COLOR_PATTERN.test(trimmedValue)) {
      return null
    }

    return trimmedValue.toLowerCase()
  },
}
