import {
  type IUpdateAsset,
  type UpdateDownloadStatus,
  type UpdateFlowState,
  type UpdateInstallType,
} from '#src/shared/api-model'

const DEB_INSTALL_CANCELLED_EXIT_CODE = 126

const DEB_INSTALL_UNAUTHORIZED_EXIT_CODE = 127

const INSTALL_TYPE_ASSET_SUFFIXES: Record<UpdateInstallType, string[]> = {
  appImage: ['.AppImage'],
  deb: ['.deb'],
  dev: ['.AppImage', '.deb'],
  dmg: ['.dmg'],
  unsupported: [],
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

  selectUpdateAsset: (params: { assets: IUpdateAsset[]; installType: UpdateInstallType }): IUpdateAsset | null => {
    const { assets, installType } = params
    const preferredSuffixes = INSTALL_TYPE_ASSET_SUFFIXES[installType]
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

  toDebInstallOutcome: (params: {
    exitCode: number | null
    isSpawnFailed: boolean
  }): 'fallback' | 'failed' | 'installed' => {
    const { exitCode, isSpawnFailed } = params

    if (isSpawnFailed) {
      return 'fallback'
    }

    if (exitCode === 0) {
      return 'installed'
    }

    if (exitCode === DEB_INSTALL_CANCELLED_EXIT_CODE || exitCode === DEB_INSTALL_UNAUTHORIZED_EXIT_CODE) {
      return 'fallback'
    }

    return 'failed'
  },

  toDownloadButtonLabel: (params: {
    downloadPercent: number | null
    latestVersion: string
    updateFlowState: UpdateFlowState
  }): string => {
    const { downloadPercent, latestVersion, updateFlowState } = params

    if (updateFlowState === 'downloading') {
      if (downloadPercent === null) {
        return 'Downloading…'
      }

      return `Downloading… ${String(downloadPercent)}%`
    }

    if (updateFlowState === 'installing') {
      return 'Installing…'
    }

    if (updateFlowState === 'restart-required') {
      return 'Restart to finish update'
    }

    if (updateFlowState === 'downloaded') {
      return 'Opened installer'
    }

    return `Download v${latestVersion}`
  },

  toInstallType: (params: {
    appImagePath: string | null
    isPackaged: boolean
    platform: string
  }): UpdateInstallType => {
    const { appImagePath, isPackaged, platform } = params

    if (platform === 'darwin') {
      return 'dmg'
    }

    if (platform !== 'linux') {
      return 'unsupported'
    }

    if (!isPackaged) {
      return 'dev'
    }

    if (appImagePath !== null) {
      return 'appImage'
    }

    return 'deb'
  },

  toUpdateButtonTitle: (params: {
    currentVersion: string
    downloadedFilePath: string | null
    latestVersion: string
    updateFlowState?: UpdateFlowState
  }): string => {
    const { currentVersion, downloadedFilePath, latestVersion, updateFlowState } = params

    if (updateFlowState === 'restart-required') {
      return 'Update installed — restart to finish'
    }

    if (updateFlowState === 'installing') {
      return 'Installing the downloaded update…'
    }

    if (downloadedFilePath !== null) {
      return `Installer saved to ${downloadedFilePath}`
    }

    return `Version ${latestVersion} available (current ${currentVersion})`
  },

  toUpdateFlowState: (params: { status: UpdateDownloadStatus }): UpdateFlowState => {
    const { status } = params

    switch (status) {
      case 'completed': {
        return 'downloaded'
      }
      case 'downloading': {
        return 'downloading'
      }
      case 'error': {
        return 'idle'
      }
      case 'idle': {
        return 'idle'
      }
      case 'installing': {
        return 'installing'
      }
      case 'restart-required': {
        return 'restart-required'
      }
      default: {
        throw new Error(`Unsupported update download status: ${String(status)}`)
      }
    }
  },
}
