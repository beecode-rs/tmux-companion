import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const FILE_MODE = 0o600

export interface IApiDiscoveryContent {
  pid: number
  port: number
  token: string
}

export class ApiDiscoveryFile {
  protected readonly _filePath: string

  constructor(params: { filePath?: string } = {}) {
    this._filePath = params.filePath ?? join(homedir(), '.tmux-companion', 'api.json')
  }

  remove(): void {
    rmSync(this._filePath, { force: true })
  }

  write(params: IApiDiscoveryContent): void {
    mkdirSync(dirname(this._filePath), { recursive: true })
    writeFileSync(this._filePath, `${JSON.stringify(params)}\n`, { mode: FILE_MODE })
  }
}
