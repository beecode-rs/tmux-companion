export type ITrayIconColor = readonly [number, number, number]

export const trayIconUtil = {
  toColoredBitmap(params: { bitmap: number[]; color: ITrayIconColor }): number[] {
    const { bitmap, color } = params

    return bitmap.map((value, index) => {
      const isAlphaChannel = index % 4 === 3

      if (isAlphaChannel) {
        return value
      }

      const alphaChannelIndex = index + 3 - (index % 4)

      if (bitmap[alphaChannelIndex] === 0) {
        return value
      }

      const colorChannels = [color[0], color[1], color[2]]

      return colorChannels[index % 4] ?? value
    })
  },
}
