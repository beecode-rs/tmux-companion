import { app, shell } from 'electron'
import { spawn } from 'node:child_process'
import { constants, createWriteStream } from 'node:fs'
import { access, chmod, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import {
  type IUpdateAsset,
  type IUpdateCheckFailure,
  type IUpdateCheckResponse,
  type IUpdateCheckResult,
  type IUpdateDownloadResponse,
  type IUpdateDownloadStatusResponse,
  type UpdateDownloadStatus,
  type UpdateInstallType,
} from '#src/shared/api-model'
import { updateCheckErrorUtil } from '#src/shared/update-check-error-util'
import { updateUtil } from '#src/shared/update-util'

const GITHUB_LATEST_RELEASE_URL = 'https://api.github.com/repos/beecode-rs/tmux-companion/releases/latest'

const PARTIAL_FILE_SUFFIX = '.part'

const STDERR_TAIL_MAX_LENGTH = 2048

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

  async checkForUpdate(): Promise<IUpdateCheckResult> {
    const updateCheckResult = await this._toUpdateCheckResult()

    if (updateCheckResult.status === 'failed') {
      this._warnFailedCheck({ failure: updateCheckResult.failure })
    }

    return updateCheckResult
  }

  async downloadLatestUpdate(): Promise<IUpdateDownloadResponse> {
    const busyStatusMessage = this._toBusyStatusMessage({ status: this._downloadStatus.status })

    if (busyStatusMessage !== null) {
      throw new Error(busyStatusMessage)
    }

    const asset = await this._toAvailableUpdateAsset()

    return await this._downloadAsset({ asset })
  }

  getDownloadStatus(): IUpdateDownloadStatusResponse {
    return { ...this._downloadStatus }
  }

  relaunchForUpdate(): void {
    const appImagePath = this._toAppImagePath()

    if (appImagePath !== null) {
      app.relaunch({ execPath: appImagePath })
      app.exit(0)

      return
    }

    app.relaunch()
    app.exit(0)
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
    const appImagePath = await this._toSelfUpdatableAppImagePath()
    const filePath = this._toDownloadTargetFilePath({ appImagePath, asset })
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
      await this._installDownloadedUpdate({ appImagePath, filePath, installType: this._toInstallType() })

      return { filePath, status: this._downloadStatus.status }
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

  protected async _installAppImageUpdate(params: { filePath: string }): Promise<void> {
    const { filePath } = params

    this._downloadStatus = { ...this._downloadStatus, status: 'installing' }
    await chmod(filePath, 0o755)
    this._downloadStatus = { ...this._downloadStatus, status: 'restart-required' }
  }

  protected async _installDebUpdate(params: { filePath: string }): Promise<void> {
    const { filePath } = params

    this._downloadStatus = { ...this._downloadStatus, status: 'installing' }

    const installResult = await this._toDebInstallResult({ filePath })
    const outcome = updateUtil.toDebInstallOutcome({
      exitCode: installResult.exitCode,
      isSpawnFailed: installResult.isSpawnFailed,
    })

    if (outcome === 'installed') {
      this._downloadStatus = { ...this._downloadStatus, status: 'restart-required' }

      return
    }

    if (outcome === 'fallback') {
      await shell.openPath(filePath)
      this._downloadStatus = { ...this._downloadStatus, status: 'completed' }

      return
    }

    throw new Error(`Update install failed (dpkg exit ${String(installResult.exitCode)}): ${installResult.stderrTail}`)
  }

  protected async _installDownloadedUpdate(params: {
    appImagePath: string | null
    filePath: string
    installType: UpdateInstallType
  }): Promise<void> {
    const { appImagePath, filePath, installType } = params

    if (installType === 'deb') {
      await this._installDebUpdate({ filePath })

      return
    }

    if (appImagePath !== null) {
      await this._installAppImageUpdate({ filePath })

      return
    }

    await shell.openPath(filePath)
    this._downloadStatus = { ...this._downloadStatus, status: 'completed' }
  }

  protected async _isWritableAppImageDir(params: { appImagePath: string }): Promise<boolean> {
    const { appImagePath } = params

    try {
      await access(dirname(appImagePath), constants.W_OK)

      return true
    } catch {
      return false
    }
  }

  protected _runCommand(params: {
    args: string[]
    command: string
  }): Promise<{ code: number | null; stderrTail: string }> {
    const { args, command } = params

    return new Promise((resolve, reject) => {
      const childProcess = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      const stderrChunks: Buffer[] = []

      childProcess.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk)
      })

      childProcess.on('error', (error: Error) => {
        reject(error)
      })

      childProcess.on('close', (code: number | null) => {
        const stderrTail = Buffer.concat(stderrChunks).toString('utf8').slice(-STDERR_TAIL_MAX_LENGTH)

        resolve({ code, stderrTail })
      })
    })
  }

  protected _toAppImagePath(): string | null {
    return process.env.APPIMAGE ?? null
  }

  protected async _toAvailableUpdateAsset(): Promise<IUpdateAsset> {
    const updateCheckResult = await this.checkForUpdate()

    if (updateCheckResult.status === 'failed') {
      throw new Error(updateCheckResult.failure.message)
    }

    const updateCheck = updateCheckResult.updateCheck

    if (!updateCheck.isUpdateAvailable) {
      throw new Error('No update available')
    }

    if (updateCheck.asset === null) {
      throw new Error('No matching update asset')
    }

    return updateCheck.asset
  }

  protected _toBusyStatusMessage(params: { status: UpdateDownloadStatus }): string | null {
    const { status } = params

    switch (status) {
      case 'downloading': {
        return 'Update download already in progress'
      }
      case 'installing': {
        return 'Update install already in progress'
      }
      case 'restart-required': {
        return 'Update already installed — restart to finish'
      }
      default: {
        return null
      }
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

  protected async _toDebInstallResult(params: {
    filePath: string
  }): Promise<{ exitCode: number | null; isSpawnFailed: boolean; stderrTail: string }> {
    const { filePath } = params

    try {
      const commandResult = await this._runCommand({ args: ['dpkg', '-i', filePath], command: 'pkexec' })

      return {
        exitCode: commandResult.code,
        isSpawnFailed: false,
        stderrTail: commandResult.stderrTail,
      }
    } catch {
      return { exitCode: null, isSpawnFailed: true, stderrTail: '' }
    }
  }

  protected _toDownloadFilePath(params: { asset: IUpdateAsset }): string {
    const { asset } = params
    const fileName = basename(asset.name)

    if (fileName === '' || fileName === '.' || fileName === '..') {
      throw new Error('Update asset has an invalid file name')
    }

    return join(app.getPath('downloads'), fileName)
  }

  protected _toDownloadTargetFilePath(params: { appImagePath: string | null; asset: IUpdateAsset }): string {
    const { appImagePath, asset } = params

    if (appImagePath !== null) {
      return appImagePath
    }

    return this._toDownloadFilePath({ asset })
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

  protected _toInstallType(): UpdateInstallType {
    return updateUtil.toInstallType({
      appImagePath: this._toAppImagePath(),
      isPackaged: app.isPackaged,
      platform: process.platform,
    })
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

  protected async _toSelfUpdatableAppImagePath(): Promise<string | null> {
    const appImagePath = this._toAppImagePath()

    if (appImagePath === null) {
      return null
    }

    const isWritable = await this._isWritableAppImageDir({ appImagePath })

    if (!isWritable) {
      return null
    }

    return appImagePath
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

  protected async _toUpdateCheckResult(): Promise<IUpdateCheckResult> {
    try {
      const response = await fetch(GITHUB_LATEST_RELEASE_URL, {
        headers: this._toGitHubHeaders(),
        signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
      })

      if (!response.ok) {
        return { failure: updateCheckErrorUtil.toFailureFromResponse({ response }), status: 'failed' }
      }

      return {
        status: 'ok',
        updateCheck: this._toUpdateCheckResponse({ release: (await response.json()) as IGithubReleaseResponse }),
      }
    } catch (error) {
      return { failure: updateCheckErrorUtil.toFailureFromThrown({ error }), status: 'failed' }
    }
  }

  protected _toUpdateCheckResponse(params: { release: IGithubReleaseResponse }): IUpdateCheckResponse {
    const { release } = params
    const latestVersion = updateUtil.normalizeVersion({ version: release.tag_name ?? '' })
    const currentVersion = app.getVersion()
    const asset = updateUtil.selectUpdateAsset({
      assets: this._toUpdateAssets({ release }),
      installType: this._toInstallType(),
    })

    return {
      asset,
      currentVersion,
      isUpdateAvailable: updateUtil.isNewerVersion({ candidate: latestVersion, current: currentVersion }),
      latestVersion,
      releaseUrl: release.html_url ?? '',
    }
  }

  protected _warnFailedCheck(params: { failure: IUpdateCheckFailure }): void {
    const { failure } = params

    // eslint-disable-next-line no-console
    console.warn(`tmux-companion update check failed (${failure.kind}): ${failure.message}`)
  }
}
