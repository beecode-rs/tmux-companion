import { type IUpdateAsset } from '#src/shared/api-model'

const PLATFORM_ASSET_SUFFIXES: Record<string, string[]> = {
  darwin: ['.dmg'],
  linux: ['.AppImage', '.deb'],
}

const VERSION_PREFIX_PATTERN = /^v/

export const updateUtil = {
  isNewerVersion: (params: { candidate: string; current: string }): boolean => {
    const { candidate, current } = params
    const candidateNumbers = candidate
      .replace(VERSION_PREFIX_PATTERN, '')
      .split('.')
      .map((segment) => {
        return Number(segment)
      })
    const currentNumbers = current
      .replace(VERSION_PREFIX_PATTERN, '')
      .split('.')
      .map((segment) => {
        return Number(segment)
      })
    const segmentCount = Math.max(candidateNumbers.length, currentNumbers.length)
    const segmentDifferences = Array.from({ length: segmentCount }, (_segment, index) => {
      return (candidateNumbers[index] ?? 0) - (currentNumbers[index] ?? 0)
    })
    const firstDifference = segmentDifferences.find((difference) => {
      return difference !== 0
    })

    return firstDifference !== undefined && firstDifference > 0
  },

  normalizeVersion: (params: { version: string }): string => {
    const { version } = params

    return version.replace(VERSION_PREFIX_PATTERN, '')
  },

  selectUpdateAsset: (params: { assets: IUpdateAsset[]; platform: string }): IUpdateAsset | null => {
    const { assets, platform } = params
    const preferredSuffixes = PLATFORM_ASSET_SUFFIXES[platform] ?? []
    const matchedAsset = preferredSuffixes
      .map((suffix) => {
        return assets.find((asset) => {
          return asset.name.endsWith(suffix)
        })
      })
      .find((asset) => {
        return asset !== undefined
      })

    return matchedAsset ?? null
  },
}
