import { app, shell } from 'electron'
import { createWriteStream } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import {
  type IUpdateAsset,
  type IUpdateCheckResponse,
  type IUpdateDownloadResponse,
  type IUpdateDownloadStatusResponse,
} from '#src/shared/api-model'
import { updateUtil } from '#src/shared/update-util'

const GITHUB_LATEST_RELEASE_URL = 'https://api.github.com/repos/beecode-rs/tmux-companion/releases/latest'

const PARTIAL_FILE_SUFFIX = '.part'

const UPDATE_CHECK_TIMEOUT_MS = 10000

interface IGithubReleaseAsset {
  browser_download_url?: string
  name?: string
  size?: number
}

interface IGithubReleaseResponse {
  assets?: IGithubReleaseAsset[]
  html_url?: string
  tag_name?: string
}

export class UpdateService {
  protected _downloadStatus: IUpdateDownloadStatusResponse = {
    receivedBytes: 0,
    status: 'idle',
    totalBytes: 0,
  }

  async checkForUpdate(): Promise<IUpdateCheckResponse> {
    const response = await fetch(GITHUB_LATEST_RELEASE_URL, {
      headers: this._toGitHubHeaders(),
      signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
    })

    if (!response.ok) {
      throw new Error(`GitHub release check failed with status ${String(response.status)}`)
    }

    const release = (await response.json()) as IGithubReleaseResponse

    return this._toUpdateCheckResponse({ release })
  }

  async downloadLatestUpdate(): Promise<IUpdateDownloadResponse> {
    if (this._downloadStatus.status === 'downloading') {
      throw new Error('Update download already in progress')
    }

    const updateCheck = await this.checkForUpdate()

    if (!updateCheck.isUpdateAvailable) {
      throw new Error('No update available')
    }

    if (updateCheck.asset === null) {
      throw new Error('No matching update asset for this platform')
    }

    return await this._downloadAsset({ asset: updateCheck.asset })
  }

  getDownloadStatus(): IUpdateDownloadStatusResponse {
    return { ...this._downloadStatus }
  }

  protected _addReceivedBytes(params: { bytes: number }): void {
    const { bytes } = params

    this._downloadStatus = {
      ...this._downloadStatus,
      receivedBytes: this._downloadStatus.receivedBytes + bytes,
    }
  }

  protected async _downloadAsset(params: { asset: IUpdateAsset }): Promise<IUpdateDownloadResponse> {
    const { asset } = params
    const filePath = this._toDownloadFilePath({ asset })
    const partialFilePath = `${filePath}${PARTIAL_FILE_SUFFIX}`

    this._downloadStatus = {
      filePath,
      receivedBytes: 0,
      status: 'downloading',
      totalBytes: 0,
    }

    try {
      const response = await fetch(asset.url)

      if (!response.ok) {
        throw new Error(`Update download failed with status ${String(response.status)}`)
      }

      this._downloadStatus = {
        ...this._downloadStatus,
        totalBytes: this._toContentLength({ response }),
      }

      await pipeline(this._toProgressReadable({ response }), createWriteStream(partialFilePath))
      await rename(partialFilePath, filePath)
      this._downloadStatus = { ...this._downloadStatus, status: 'completed' }
      await shell.openPath(filePath)

      return { filePath }
    } catch (error) {
      await rm(partialFilePath, { force: true }).catch(() => {
        return undefined
      })

      this._downloadStatus = {
        ...this._downloadStatus,
        errorMessage: this._toErrorMessage({ error }),
        status: 'error',
      }

      throw error
    }
  }

  protected _toContentLength(params: { response: Response }): number {
    const { response } = params
    const contentLength = Number.parseInt(response.headers.get('content-length') ?? '', 10)

    if (Number.isNaN(contentLength)) {
      return 0
    }

    return contentLength
  }

  protected _toDownloadFilePath(params: { asset: IUpdateAsset }): string {
    const { asset } = params
    const fileName = basename(asset.name)

    if (fileName === '' || fileName === '.' || fileName === '..') {
      throw new Error('Update asset has an invalid file name')
    }

    return join(app.getPath('downloads'), fileName)
  }

  protected _toErrorMessage(params: { error: unknown }): string {
    const { error } = params

    if (error instanceof Error) {
      return error.message
    }

    return String(error)
  }

  protected _toGitHubHeaders(): Headers {
    const headers = new Headers()

    headers.append('Accept', 'application/vnd.github+json')
    headers.append('User-Agent', `tmux-companion/${app.getVersion()}`)

    return headers
  }

  protected _toProgressReadable(params: { response: Response }): Readable {
    const { response } = params

    if (response.body === null) {
      throw new Error('Update download returned no content')
    }

    const readable = Readable.fromWeb(response.body)

    readable.on('data', (chunk: Buffer) => {
      this._addReceivedBytes({ bytes: chunk.length })
    })

    return readable
  }

  protected _toUpdateAssets(params: { release: IGithubReleaseResponse }): IUpdateAsset[] {
    const { release } = params

    return (release.assets ?? []).reduce<IUpdateAsset[]>((assets, asset) => {
      if (typeof asset.name !== 'string' || typeof asset.browser_download_url !== 'string') {
        return assets
      }

      return [...assets, { name: asset.name, size: asset.size ?? 0, url: asset.browser_download_url }]
    }, [])
  }

  protected _toUpdateCheckResponse(params: { release: IGithubReleaseResponse }): IUpdateCheckResponse {
    const { release } = params
    const latestVersion = updateUtil.normalizeVersion({ version: release.tag_name ?? '' })
    const currentVersion = app.getVersion()
    const asset = updateUtil.selectUpdateAsset({
      assets: this._toUpdateAssets({ release }),
      platform: process.platform,
    })

    return {
      asset,
      currentVersion,
      isUpdateAvailable: updateUtil.isNewerVersion({ candidate: latestVersion, current: currentVersion }),
      latestVersion,
      releaseUrl: release.html_url ?? '',
    }
  }
}
