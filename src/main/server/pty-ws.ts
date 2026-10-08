import { timingSafeEqual } from 'node:crypto'
import { type Server as HttpServer, type IncomingMessage } from 'node:http'
import { type Duplex } from 'node:stream'
import { type RawData, WebSocket, WebSocketServer } from 'ws'

import { type PtyService } from '#src/main/business/service/pty-service'
import { type TerminalMode } from '#src/shared/terminal-mode-model'
import {
  type IGetScrollStateFrame,
  type IScrollStateFrame,
  type TerminalCursorKeys,
  type TerminalScrollDirection,
} from '#src/shared/terminal-scroll-model'
import { type ICopySelectionFrame, type ISelectionTextFrame } from '#src/shared/terminal-selection-model'

const PTY_EXIT_CLOSE_CODE = 4000

const PTY_UNKNOWN_INSTANCE_CLOSE_CODE = 4001

const PTY_WS_PATH_PREFIX = '/pty/'

interface IResizeFrame {
  cols: number
  rows: number
  type: 'resize'
}

interface IScrollFrame {
  cursorKeys: TerminalCursorKeys
  direction: TerminalScrollDirection
  lines: number
  type: 'scroll'
}

export class PtyWsServer {
  protected readonly _ptyService: PtyService

  protected readonly _token: string

  protected readonly _wss = new WebSocketServer({ noServer: true })

  constructor(params: { ptyService: PtyService; token: string }) {
    this._ptyService = params.ptyService
    this._token = params.token
  }

  attach(params: { httpServer: HttpServer }): void {
    params.httpServer.on('upgrade', (request, socket, head) => {
      this._handleUpgrade({ head, request, socket })
    })
  }

  stop(): void {
    this._wss.clients.forEach((ws) => {
      ws.terminate()
    })

    this._wss.close()
  }

  protected _handleClientFrame(params: { data: RawData; instanceId: string; mode: TerminalMode; ws: WebSocket }): void {
    const text = this._toText({ data: params.data })
    const resizeFrame = this._toResizeFrame({ text })

    if (resizeFrame !== null) {
      this._ptyService.resize({
        cols: resizeFrame.cols,
        instanceId: params.instanceId,
        mode: params.mode,
        rows: resizeFrame.rows,
      })

      return
    }

    const scrollFrame = this._toScrollFrame({ text })

    if (scrollFrame !== null) {
      void this._ptyService
        .scroll({
          cursorKeys: scrollFrame.cursorKeys,
          direction: scrollFrame.direction,
          instanceId: params.instanceId,
          lines: scrollFrame.lines,
          mode: params.mode,
        })
        .catch(() => {
          return undefined
        })

      return
    }

    const getScrollStateFrame = this._toGetScrollStateFrame({ text })

    if (getScrollStateFrame !== null) {
      void this._ptyService
        .getScrollState({ instanceId: params.instanceId, mode: params.mode })
        .then((scrollState) => {
          this._sendScrollState({ scrollState, ws: params.ws })
        })
        .catch(() => {
          return undefined
        })

      return
    }

    const copySelectionFrame = this._toCopySelectionFrame({ text })

    if (copySelectionFrame !== null) {
      void this._ptyService
        .copySelection({ instanceId: params.instanceId, mode: params.mode })
        .then((text) => {
          if (text !== null) {
            this._sendSelectionText({ text, ws: params.ws })
          }
        })
        .catch(() => {
          return undefined
        })

      return
    }

    this._ptyService.write({ data: text, instanceId: params.instanceId, mode: params.mode })
  }

  protected async _handleConnection(params: { instanceId: string; mode: TerminalMode; ws: WebSocket }): Promise<void> {
    const queuedFrames: RawData[] = []

    const queueFrame = (data: RawData): void => {
      queuedFrames.push(data)
    }

    params.ws.on('message', queueFrame)

    try {
      await this._ptyService.getOrCreate({ instanceId: params.instanceId, mode: params.mode })
    } catch (error) {
      params.ws.off('message', queueFrame)
      params.ws.close(PTY_UNKNOWN_INSTANCE_CLOSE_CODE, this._toErrorMessage({ error }))

      return
    }

    params.ws.off('message', queueFrame)

    const handleFrame = (data: RawData): void => {
      this._handleClientFrame({ data, instanceId: params.instanceId, mode: params.mode, ws: params.ws })
    }

    params.ws.on('message', handleFrame)
    queuedFrames.forEach((data) => {
      handleFrame(data)
    })

    const unsubscribeData = this._ptyService.onData({
      callback: (data) => {
        if (params.ws.readyState === WebSocket.OPEN) {
          params.ws.send(data)
        }
      },
      instanceId: params.instanceId,
      mode: params.mode,
    })

    const unsubscribeExit = this._ptyService.onExit({
      callback: (reason) => {
        params.ws.close(PTY_EXIT_CLOSE_CODE, JSON.stringify(reason))
      },
      instanceId: params.instanceId,
      mode: params.mode,
    })

    params.ws.on('close', () => {
      unsubscribeData()
      unsubscribeExit()
    })

    params.ws.on('error', () => {
      params.ws.close()
    })
  }

  protected _handleUpgrade(params: { head: Buffer; request: IncomingMessage; socket: Duplex }): void {
    const url = new URL(params.request.url ?? '/', 'http://127.0.0.1')
    const instanceId = this._toInstanceId({ pathname: url.pathname })
    const mode = this._toMode({ value: url.searchParams.get('mode') })

    if (instanceId === null || mode === null || !this._isTokenValid({ token: url.searchParams.get('token') ?? '' })) {
      params.socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      params.socket.destroy()

      return
    }

    this._wss.handleUpgrade(params.request, params.socket, params.head, (ws) => {
      void this._handleConnection({ instanceId, mode, ws })
    })
  }

  protected _isCursorKeys(value: unknown): value is TerminalCursorKeys {
    return value === 'application' || value === 'normal'
  }

  protected _isPositiveInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0
  }

  protected _isScrollDirection(value: unknown): value is TerminalScrollDirection {
    return value === 'up' || value === 'down'
  }

  protected _isTokenValid(params: { token: string }): boolean {
    const expectedBuffer = Buffer.from(this._token)
    const providedBuffer = Buffer.from(params.token)

    if (expectedBuffer.length !== providedBuffer.length) {
      return false
    }

    return timingSafeEqual(expectedBuffer, providedBuffer)
  }

  protected _sendScrollState(params: { scrollState: IScrollStateFrame; ws: WebSocket }): void {
    if (params.ws.readyState !== WebSocket.OPEN) {
      return
    }

    params.ws.send(Buffer.from(JSON.stringify(params.scrollState)))
  }

  protected _sendSelectionText(params: { text: string; ws: WebSocket }): void {
    if (params.ws.readyState !== WebSocket.OPEN) {
      return
    }

    const frame: ISelectionTextFrame = { text: params.text, type: 'selection-text' }

    params.ws.send(Buffer.from(JSON.stringify(frame)))
  }

  protected _toCopySelectionFrame(params: { text: string }): ICopySelectionFrame | null {
    const parsed = this._toParsedJson({ text: params.text })

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null
    }

    const keys = Object.keys(parsed).sort()

    if (keys.length !== 1 || keys[0] !== 'type') {
      return null
    }

    if ((parsed as Record<string, unknown>)['type'] !== 'copy-selection') {
      return null
    }

    return { type: 'copy-selection' }
  }

  protected _toErrorMessage(params: { error: unknown }): string {
    if (params.error instanceof Error) {
      return params.error.message
    }

    return String(params.error)
  }

  protected _toGetScrollStateFrame(params: { text: string }): IGetScrollStateFrame | null {
    const parsed = this._toParsedJson({ text: params.text })

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null
    }

    const keys = Object.keys(parsed).sort()

    if (keys.length !== 1 || keys[0] !== 'type') {
      return null
    }

    if ((parsed as Record<string, unknown>)['type'] !== 'get-scroll-state') {
      return null
    }

    return { type: 'get-scroll-state' }
  }

  protected _toInstanceId(params: { pathname: string }): string | null {
    if (!params.pathname.startsWith(PTY_WS_PATH_PREFIX)) {
      return null
    }

    const instanceId = decodeURIComponent(params.pathname.slice(PTY_WS_PATH_PREFIX.length))

    if (instanceId === '' || instanceId.includes('/')) {
      return null
    }

    return instanceId
  }

  protected _toMode(params: { value: string | null }): TerminalMode | null {
    if (params.value === null || params.value === '') {
      return 'tmux'
    }

    if (params.value === 'machine' || params.value === 'tmux') {
      return params.value
    }

    return null
  }

  protected _toParsedJson(params: { text: string }): unknown {
    try {
      return JSON.parse(params.text) as unknown
    } catch (_error) {
      return null
    }
  }

  protected _toResizeFrame(params: { text: string }): IResizeFrame | null {
    const parsed = this._toParsedJson({ text: params.text })

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null
    }

    const keys = Object.keys(parsed).sort()

    if (keys.length !== 3 || keys[0] !== 'cols' || keys[1] !== 'rows' || keys[2] !== 'type') {
      return null
    }

    const record = parsed as Record<string, unknown>
    const cols = record['cols']
    const rows = record['rows']

    if (record['type'] !== 'resize' || !this._isPositiveInteger(cols) || !this._isPositiveInteger(rows)) {
      return null
    }

    return { cols, rows, type: 'resize' }
  }

  protected _toScrollFrame(params: { text: string }): IScrollFrame | null {
    const parsed = this._toParsedJson({ text: params.text })

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null
    }

    const keys = Object.keys(parsed).sort()

    if (
      keys.length !== 4 ||
      keys[0] !== 'cursorKeys' ||
      keys[1] !== 'direction' ||
      keys[2] !== 'lines' ||
      keys[3] !== 'type'
    ) {
      return null
    }

    const record = parsed as Record<string, unknown>
    const cursorKeys = record['cursorKeys']
    const direction = record['direction']
    const lines = record['lines']

    if (
      record['type'] !== 'scroll' ||
      !this._isCursorKeys(cursorKeys) ||
      !this._isScrollDirection(direction) ||
      !this._isPositiveInteger(lines)
    ) {
      return null
    }

    return { cursorKeys, direction, lines, type: 'scroll' }
  }

  protected _toText(params: { data: RawData }): string {
    if (Array.isArray(params.data)) {
      return params.data
        .map((chunk) => {
          return chunk.toString()
        })
        .join('')
    }

    if (params.data instanceof ArrayBuffer) {
      return Buffer.from(params.data).toString()
    }

    return params.data.toString()
  }
}
