export const trayIconUtil = {
  toThemedBitmap(params: { bitmap: number[]; isDarkColors: boolean }): number[] {
    const { bitmap, isDarkColors } = params

    if (!isDarkColors) {
      return bitmap
    }

    return bitmap.map((value, index) => {
      const isAlphaChannel = index % 4 === 3

      if (isAlphaChannel) {
        return value
      }

      const alphaChannelIndex = index + 3 - (index % 4)

      if (bitmap[alphaChannelIndex] === 0) {
        return value
      }

      return 255
    })
  },
}
