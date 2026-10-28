import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react'

import { ApiClient } from '#src/renderer/src/business/service/api-client'
import { type InstanceTerminalRequest, useInstances } from '#src/renderer/src/business/service/instances-store'
import { terminalA11ySelectionUtil } from '#src/renderer/src/ui-component/terminal-view/terminal-a11y-selection-util'
import { terminalGlyphUtil } from '#src/renderer/src/ui-component/terminal-view/terminal-glyph-util'
import { TerminalScrollbar } from '#src/renderer/src/ui-component/terminal-view/terminal-scrollbar'
import {
  type ISelectionReplayPoint,
  terminalSelectionReplayUtil,
} from '#src/renderer/src/ui-component/terminal-view/terminal-selection-replay-util'
import { terminalUnicodeProvider } from '#src/renderer/src/ui-component/terminal-view/terminal-unicode-provider'
import { type IGetThemeResponse } from '#src/shared/api-model'
import { type TerminalMode } from '#src/shared/terminal-mode-model'
import {
  type IScrollStateFrame,
  type TerminalCursorKeys,
  type TerminalScrollDirection,
} from '#src/shared/terminal-scroll-model'

import '#src/renderer/src/ui-component/terminal-view/terminal-view.css'

const DEFAULT_TERMINAL_FONT_FAMILY = 'courier-new, courier, monospace'

const DEFAULT_TERMINAL_FONT_SIZE = 15

const PTY_EXIT_CLOSE_CODE = 4000

const PTY_UNKNOWN_INSTANCE_CLOSE_CODE = 4001

const TERMINAL_BACKGROUND = '#111111'

const TERMINAL_MOUSE_REPORTING_MODES = [1000, 1002, 1003]

const TERMINAL_SCROLLBACK = 5000

const TERMINAL_SCROLL_FLUSH_MS = 30

const TERMINAL_SCROLL_MAX_LINES = 100

const TERMINAL_SCROLL_STATE_INPUT_FOLLOWUP_MS = 150

const TERMINAL_SCROLL_STATE_INPUT_MIN_INTERVAL_MS = 400

const TERMINAL_SCROLL_STATE_POLL_MS = 200

const TERMINAL_SCROLL_STATE_SLOW_POLL_MS = 1500

const TERMINAL_SELECTION_DRAG_THRESHOLD_PX = 3

interface ITerminalConnectionSnapshot {
  isConnected: boolean
  message: string | null
}

interface ITerminalExitReason {
  exitCode: number
  signal?: number
}

interface ITerminalScrollState {
  applicationCursorKeys: boolean
  flushTimeoutId: ReturnType<typeof setTimeout> | null
  historySize: number
  isMouseReportingActive: boolean
  isInCopyMode: boolean
  lastInputPollAt: number
  pendingDirection: TerminalScrollDirection
  pendingLines: number
  pollTimeoutId: ReturnType<typeof setTimeout> | null
  scrollPosition: number
}

interface ITerminalSession {
  element: HTMLDivElement
  fitAddon: FitAddon
  instanceId: string
  isConnected: boolean
  isOpened: boolean
  lastError: string | null
  mode: TerminalMode
  scrollState: ITerminalScrollState
  terminal: Terminal
  webSocket: WebSocket | null
}

interface ITerminalScrollbarSnapshot {
  historySize: number
  isInCopyMode: boolean
  rows: number
  scrollPosition: number
}

type ITerminalScrollStateChangeHandler = (params: { session: ITerminalSession }) => void

const applyDecPrivateModes = (params: {
  csiParams: (number | number[])[]
  isEnabled: boolean
  session: ITerminalSession
}): void => {
  if (params.csiParams.includes(1)) {
    params.session.scrollState.applicationCursorKeys = params.isEnabled
  }

  if (
    params.csiParams.some((csiParam) => {
      return typeof csiParam === 'number' && TERMINAL_MOUSE_REPORTING_MODES.includes(csiParam)
    })
  ) {
    params.session.scrollState.isMouseReportingActive = params.isEnabled
  }
}

const applyTerminalSize = (params: { session: ITerminalSession }): void => {
  const dimensions = params.session.fitAddon.proposeDimensions()

  if (dimensions === undefined) {
    return
  }

  if (dimensions.cols < 1 || dimensions.rows < 1) {
    return
  }

  sendResizeFrame({ cols: dimensions.cols, rows: dimensions.rows, session: params.session })
  params.session.fitAddon.fit()
}

const applySessionTheme = (params: { session: ITerminalSession; theme: IGetThemeResponse | null }): void => {
  params.session.terminal.options.fontFamily = params.theme?.fontFamily ?? DEFAULT_TERMINAL_FONT_FAMILY
  params.session.terminal.options.fontSize = params.theme?.fontSize ?? DEFAULT_TERMINAL_FONT_SIZE
  params.session.terminal.options.theme = {
    background: params.theme?.theme?.background ?? TERMINAL_BACKGROUND,
    cursor: params.theme?.theme?.cursor,
    foreground: params.theme?.theme?.foreground,
    selectionBackground: params.theme?.theme?.selectionBackground,
    selectionForeground: params.theme?.theme?.selectionForeground,
  }
  applyTerminalSize({ session: params.session })
  scheduleTerminalFit({ session: params.session })
}

const applyA11ySelectionMirror = (params: { session: ITerminalSession; text: string }): void => {
  const textarea = params.session.terminal.textarea

  if (textarea === undefined) {
    return
  }

  terminalA11ySelectionUtil.applySelectionMirror({ text: params.text, textarea })
}

const clearA11ySelectionMirror = (params: { session: ITerminalSession }): void => {
  const textarea = params.session.terminal.textarea

  if (textarea === undefined) {
    return
  }

  terminalA11ySelectionUtil.clearSelectionMirror({ textarea })
}

const replayPaneSwallowedSelection = (params: {
  from: ISelectionReplayPoint
  session: ITerminalSession
  to: ISelectionReplayPoint
}): string | undefined => {
  // Panes that enable mouse reporting (opencode, fullscreen claude code)
  // consume drags themselves: neither xterm nor tmux ends up with a
  // selection, so the a11y mirror stays empty and assistive tech reads
  // whatever else the app exposes (the sidebar). Re-running the drag as
  // xterm's modifier-forced gesture creates a real selection after the
  // fact; onSelectionChange mirrors it again on the next frame.
  terminalSelectionReplayUtil.replayForcedSelection({
    from: params.from,
    terminal: params.session.terminal,
    to: params.to,
  })

  const selection = params.session.terminal.getSelection()

  if (selection === '') {
    return undefined
  }

  applyA11ySelectionMirror({ session: params.session, text: selection })

  return selection
}

const applyScrollStateFrame = (params: {
  data: ArrayBuffer
  onScrollStateChange: ITerminalScrollStateChangeHandler
  session: ITerminalSession
}): void => {
  const scrollStateFrame = toParsedScrollStateFrame({ data: params.data })

  if (scrollStateFrame === null) {
    return
  }

  params.session.scrollState.historySize = scrollStateFrame.historySize
  params.session.scrollState.isInCopyMode = scrollStateFrame.isInCopyMode
  params.session.scrollState.scrollPosition = scrollStateFrame.scrollPosition
  params.onScrollStateChange({ session: params.session })
}

const connectTerminalSession = (params: {
  onConnectedChange: (params: { instanceId: string; isConnected: boolean }) => void
  onScrollStateChange: ITerminalScrollStateChangeHandler
  onStateChange: () => void
  onTmuxExit: (params: { instanceId: string }) => Promise<void>
  session: ITerminalSession
}): void => {
  disconnectTerminalSession({ onScrollStateChange: params.onScrollStateChange, session: params.session })

  const webSocket = new WebSocket(toWebSocketUrl({ instanceId: params.session.instanceId, mode: params.session.mode }))

  webSocket.binaryType = 'arraybuffer'

  webSocket.onclose = (event: CloseEvent) => {
    params.session.isConnected = false
    params.session.lastError = toCloseMessage({ code: event.code, reason: event.reason })
    params.onConnectedChange({ instanceId: params.session.instanceId, isConnected: false })
    params.onStateChange()
    resetTerminalScrollState({ onScrollStateChange: params.onScrollStateChange, session: params.session })
    clearA11ySelectionMirror({ session: params.session })

    if (event.code === PTY_EXIT_CLOSE_CODE && params.session.mode === 'tmux') {
      void params.onTmuxExit({ instanceId: params.session.instanceId })
    }
  }

  webSocket.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
    if (typeof event.data === 'string') {
      // Lone regional indicator letters get a narrow ASCII substitute (see
      // terminal-glyph-util); everything else passes through untouched.
      params.session.terminal.write(terminalGlyphUtil.toRenderableText(event.data))

      return
    }

    const selectionTextFrame = terminalA11ySelectionUtil.toParsedSelectionTextFrame({
      text: new TextDecoder().decode(event.data),
    })

    if (selectionTextFrame !== null) {
      applyA11ySelectionMirror({ session: params.session, text: selectionTextFrame.text })

      return
    }

    applyScrollStateFrame({
      data: event.data,
      onScrollStateChange: params.onScrollStateChange,
      session: params.session,
    })
    scheduleScrollStatePoll({ session: params.session })
  }

  webSocket.onopen = () => {
    params.session.isConnected = true
    params.session.lastError = null
    params.onConnectedChange({ instanceId: params.session.instanceId, isConnected: true })
    applyTerminalSize({ session: params.session })
    params.onStateChange()
  }

  params.session.webSocket = webSocket
}

const disconnectTerminalSession = (params: {
  onScrollStateChange: ITerminalScrollStateChangeHandler
  session: ITerminalSession
}): void => {
  const webSocket = params.session.webSocket

  if (webSocket === null) {
    return
  }

  params.session.webSocket = null
  webSocket.onclose = null
  webSocket.onmessage = null
  webSocket.onopen = null
  webSocket.close()
  resetTerminalScrollState({ onScrollStateChange: params.onScrollStateChange, session: params.session })
  clearA11ySelectionMirror({ session: params.session })
}

const flushTerminalScroll = (params: { session: ITerminalSession }): void => {
  if (params.session.scrollState.flushTimeoutId !== null) {
    clearTimeout(params.session.scrollState.flushTimeoutId)
    params.session.scrollState.flushTimeoutId = null
  }

  const lines = params.session.scrollState.pendingLines

  params.session.scrollState.pendingLines = 0

  if (lines === 0) {
    return
  }

  sendScrollFrame({
    cursorKeys: toCursorKeys({ applicationCursorKeys: params.session.scrollState.applicationCursorKeys }),
    direction: params.session.scrollState.pendingDirection,
    lines,
    session: params.session,
  })

  if (params.session.mode === 'tmux') {
    queueScrollStatePoll({ delayMs: TERMINAL_SCROLL_STATE_POLL_MS, session: params.session })
  }
}

const focusTerminalSession = (params: { session: ITerminalSession }): void => {
  const isActiveElementInput = document.activeElement instanceof HTMLInputElement

  if (isActiveElementInput) {
    return
  }

  params.session.terminal.focus()
}

const isSessionReconnectable = (params: { session: ITerminalSession }): boolean => {
  if (params.session.webSocket === null) {
    return true
  }

  return params.session.webSocket.readyState === WebSocket.CLOSED
}

const isWheelLeftToTerminal = (params: { event: WheelEvent; session: ITerminalSession }): boolean => {
  if (params.event.deltaY === 0) {
    return true
  }

  if (params.session.scrollState.isMouseReportingActive) {
    queueScrollStatePollAfterInput({ session: params.session })

    return true
  }

  if (params.session.terminal.buffer.active.type === 'normal') {
    queueScrollStatePollAfterInput({ session: params.session })

    return true
  }

  queueTerminalScroll({ event: params.event, session: params.session })

  return false
}

const pollScrollState = (params: { session: ITerminalSession }): void => {
  if (params.session.mode !== 'tmux' || !params.session.element.isConnected) {
    return
  }

  if (params.session.webSocket?.readyState !== WebSocket.OPEN) {
    return
  }

  sendGetScrollStateFrame({ session: params.session })
}

const queueScrollStatePoll = (params: { delayMs: number; session: ITerminalSession }): void => {
  stopScrollStatePoll({ session: params.session })

  params.session.scrollState.pollTimeoutId = setTimeout(() => {
    params.session.scrollState.pollTimeoutId = null
    pollScrollState({ session: params.session })
  }, params.delayMs)
}

const queueScrollStatePollAfterInput = (params: { session: ITerminalSession }): void => {
  if (params.session.mode !== 'tmux') {
    return
  }

  const scrollState = params.session.scrollState

  if (scrollState.isInCopyMode) {
    queueScrollStatePoll({ delayMs: TERMINAL_SCROLL_STATE_INPUT_FOLLOWUP_MS, session: params.session })

    return
  }

  if (Date.now() - scrollState.lastInputPollAt < TERMINAL_SCROLL_STATE_INPUT_MIN_INTERVAL_MS) {
    return
  }

  scrollState.lastInputPollAt = Date.now()
  queueScrollStatePoll({ delayMs: TERMINAL_SCROLL_STATE_INPUT_FOLLOWUP_MS, session: params.session })
}

const queueTerminalScroll = (params: { event: WheelEvent; session: ITerminalSession }): void => {
  const scrollState = params.session.scrollState
  const direction = toScrollDirection({ deltaY: params.event.deltaY })

  if (scrollState.pendingDirection !== direction) {
    scrollState.pendingLines = 0
  }

  scrollState.pendingDirection = direction
  scrollState.pendingLines = Math.min(
    scrollState.pendingLines + toWheelLines({ event: params.event, session: params.session }),
    TERMINAL_SCROLL_MAX_LINES,
  )

  scrollState.flushTimeoutId ??= setTimeout(() => {
    flushTerminalScroll({ session: params.session })
  }, TERMINAL_SCROLL_FLUSH_MS)
}

const registerDecPrivateModeTracking = (params: { session: ITerminalSession }): void => {
  params.session.terminal.parser.registerCsiHandler({ final: 'h', prefix: '?' }, (csiParams) => {
    applyDecPrivateModes({ csiParams, isEnabled: true, session: params.session })

    return false
  })

  params.session.terminal.parser.registerCsiHandler({ final: 'l', prefix: '?' }, (csiParams) => {
    applyDecPrivateModes({ csiParams, isEnabled: false, session: params.session })

    return false
  })
}

const resetTerminalScrollState = (params: {
  onScrollStateChange: ITerminalScrollStateChangeHandler
  session: ITerminalSession
}): void => {
  stopScrollStatePoll({ session: params.session })

  params.session.scrollState.historySize = 0
  params.session.scrollState.isInCopyMode = false
  params.session.scrollState.scrollPosition = 0
  params.onScrollStateChange({ session: params.session })
}

const scheduleScrollStatePoll = (params: { session: ITerminalSession }): void => {
  if (params.session.scrollState.isInCopyMode) {
    queueScrollStatePoll({ delayMs: TERMINAL_SCROLL_STATE_POLL_MS, session: params.session })

    return
  }

  queueScrollStatePoll({ delayMs: TERMINAL_SCROLL_STATE_SLOW_POLL_MS, session: params.session })
}

const scheduleTerminalFit = (params: { session: ITerminalSession }): void => {
  void document.fonts.ready.then(() => {
    requestAnimationFrame(() => {
      applyTerminalSize(params)
    })
  })
}

const sendCopySelectionFrame = (params: { session: ITerminalSession; text?: string }): void => {
  if (params.session.mode !== 'tmux') {
    return
  }

  if (!params.session.scrollState.isMouseReportingActive) {
    return
  }

  const webSocket = params.session.webSocket

  if (webSocket?.readyState !== WebSocket.OPEN) {
    return
  }

  webSocket.send(JSON.stringify({ text: params.text, type: 'copy-selection' }))
}

const sendGetScrollStateFrame = (params: { session: ITerminalSession }): void => {
  const webSocket = params.session.webSocket

  if (webSocket?.readyState !== WebSocket.OPEN) {
    return
  }

  webSocket.send(JSON.stringify({ type: 'get-scroll-state' }))
}

const sendResizeFrame = (params: { cols: number; rows: number; session: ITerminalSession }): void => {
  const webSocket = params.session.webSocket

  if (webSocket?.readyState !== WebSocket.OPEN) {
    return
  }

  webSocket.send(JSON.stringify({ cols: params.cols, rows: params.rows, type: 'resize' }))
}

const sendScrollFrame = (params: {
  cursorKeys: TerminalCursorKeys
  direction: TerminalScrollDirection
  lines: number
  session: ITerminalSession
}): void => {
  const webSocket = params.session.webSocket

  if (webSocket?.readyState !== WebSocket.OPEN) {
    return
  }

  webSocket.send(
    JSON.stringify({ cursorKeys: params.cursorKeys, direction: params.direction, lines: params.lines, type: 'scroll' }),
  )
}

const sendTextInput = (params: { data: string; session: ITerminalSession }): void => {
  const webSocket = params.session.webSocket

  if (webSocket?.readyState !== WebSocket.OPEN) {
    return
  }

  webSocket.send(params.data)
  queueScrollStatePollAfterInput({ session: params.session })
}

const stopScrollStatePoll = (params: { session: ITerminalSession }): void => {
  const pollTimeoutId = params.session.scrollState.pollTimeoutId

  if (pollTimeoutId !== null) {
    clearTimeout(pollTimeoutId)
    params.session.scrollState.pollTimeoutId = null
  }
}

const toCloseMessage = (params: { code: number; reason: string }): string => {
  if (params.code === PTY_EXIT_CLOSE_CODE) {
    return toExitMessage({ reason: params.reason })
  }

  if (params.code === PTY_UNKNOWN_INSTANCE_CLOSE_CODE) {
    return params.reason
  }

  if (params.reason !== '') {
    return params.reason
  }

  return 'Connection closed'
}

const toConnectionSnapshot = (params: { session: ITerminalSession }): ITerminalConnectionSnapshot => {
  return { isConnected: params.session.isConnected, message: params.session.lastError }
}

const toCursorKeys = (params: { applicationCursorKeys: boolean }): TerminalCursorKeys => {
  if (params.applicationCursorKeys) {
    return 'application'
  }

  return 'normal'
}

const toExitMessage = (params: { reason: string }): string => {
  const exitReason = toParsedExitReason({ reason: params.reason })

  if (exitReason === null) {
    return 'Process exited'
  }

  if (exitReason.signal !== undefined && exitReason.signal > 0) {
    return `Process exited (signal ${String(exitReason.signal)})`
  }

  return `Process exited (code ${String(exitReason.exitCode)})`
}

const toParsedExitReason = (params: { reason: string }): ITerminalExitReason | null => {
  try {
    const parsed = JSON.parse(params.reason) as { exitCode?: unknown; signal?: unknown }

    if (typeof parsed.exitCode !== 'number') {
      return null
    }

    if (parsed.signal === undefined) {
      return { exitCode: parsed.exitCode }
    }

    if (typeof parsed.signal !== 'number') {
      return null
    }

    return { exitCode: parsed.exitCode, signal: parsed.signal }
  } catch {
    return null
  }
}

const toParsedScrollStateFrame = (params: { data: ArrayBuffer }): IScrollStateFrame | null => {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(params.data)) as unknown

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null
    }

    const record = parsed as Record<string, unknown>

    if (
      typeof record['historySize'] !== 'number' ||
      typeof record['isInCopyMode'] !== 'boolean' ||
      typeof record['scrollPosition'] !== 'number'
    ) {
      return null
    }

    return {
      historySize: record['historySize'],
      isInCopyMode: record['isInCopyMode'],
      scrollPosition: record['scrollPosition'],
    }
  } catch {
    return null
  }
}

const toScrollDirection = (params: { deltaY: number }): TerminalScrollDirection => {
  if (params.deltaY < 0) {
    return 'up'
  }

  return 'down'
}

const toSessionClassName = (params: { mode: TerminalMode }): string => {
  if (params.mode === 'tmux') {
    return 'terminal-view-session is-tmux'
  }

  return 'terminal-view-session'
}

const isScrollbarSnapshotEqual = (params: {
  next: ITerminalScrollbarSnapshot
  previous: ITerminalScrollbarSnapshot
}): boolean => {
  return (
    params.next.historySize === params.previous.historySize &&
    params.next.isInCopyMode === params.previous.isInCopyMode &&
    params.next.rows === params.previous.rows &&
    params.next.scrollPosition === params.previous.scrollPosition
  )
}

const toSessionKey = (params: { instanceId: string; mode: TerminalMode }): string => {
  return `${params.instanceId}:${params.mode}`
}

const toScrollbarSnapshot = (params: { session: ITerminalSession }): ITerminalScrollbarSnapshot => {
  return {
    historySize: params.session.scrollState.historySize,
    isInCopyMode: params.session.scrollState.isInCopyMode,
    rows: params.session.terminal.rows,
    scrollPosition: params.session.scrollState.scrollPosition,
  }
}

const toTerminalSession = (params: {
  instanceId: string
  mode: TerminalMode
  onConnectedChange: (params: { instanceId: string; isConnected: boolean }) => void
  onScrollStateChange: ITerminalScrollStateChangeHandler
  onStateChange: () => void
  onTmuxExit: (params: { instanceId: string }) => Promise<void>
}): ITerminalSession => {
  const element = document.createElement('div')
  const fitAddon = new FitAddon()
  const terminal = new Terminal({
    // terminal.unicode (the custom Unicode provider registration below) is
    // proposed API and throws on access without this flag.
    allowProposedApi: true,
    // Option+click would otherwise move the cursor (a stray sequence into the
    // pane) whenever a forced-selection gesture covers a single cell;
    // selection is the only Option behavior we want.
    altClickMovesCursor: false,
    // tmux always enables mouse reporting on its clients, so xterm disables its
    // selection service and forwards every drag into tmux. Panes that grab the
    // mouse themselves (opencode, claude code) swallow those drags, leaving no
    // selection anywhere for assistive tech to read. Option-drag (Shift-drag
    // off-mac) forces xterm's own selection even in mouse mode, which feeds
    // the a11y selection mirror.
    macOptionClickForcesSelection: true,
    scrollback: TERMINAL_SCROLLBACK,
    theme: { background: TERMINAL_BACKGROUND },
  })
  // xterm.js measures cells with its built-in Unicode 6 widths, but tmux lays
  // out its grid with modern Unicode (utf8proc): emoji get two columns there
  // and one here, so the DOM renderer squeezed them into a single cell and
  // the next cell painted over their right half.
  terminal.unicode.register(terminalUnicodeProvider)
  terminal.unicode.activeVersion = terminalUnicodeProvider.version
  const session: ITerminalSession = {
    element,
    fitAddon,
    instanceId: params.instanceId,
    isConnected: false,
    isOpened: false,
    lastError: null,
    mode: params.mode,
    scrollState: {
      applicationCursorKeys: false,
      flushTimeoutId: null,
      historySize: 0,
      isInCopyMode: false,
      isMouseReportingActive: false,
      lastInputPollAt: 0,
      pendingDirection: 'up',
      pendingLines: 0,
      pollTimeoutId: null,
      scrollPosition: 0,
    },
    terminal,
    webSocket: null,
  }

  element.className = toSessionClassName({ mode: params.mode })
  terminal.loadAddon(new WebLinksAddon())
  terminal.loadAddon(fitAddon)
  registerDecPrivateModeTracking({ session })
  terminal.attachCustomWheelEventHandler((event: WheelEvent) => {
    return isWheelLeftToTerminal({ event, session })
  })
  terminal.onData((data: string) => {
    sendTextInput({ data, session })
  })
  terminal.onSelectionChange(() => {
    if (terminal.hasSelection()) {
      applyA11ySelectionMirror({ session, text: terminal.getSelection() })

      return
    }

    clearA11ySelectionMirror({ session })
  })

  connectTerminalSession({
    onConnectedChange: params.onConnectedChange,
    onScrollStateChange: params.onScrollStateChange,
    onStateChange: params.onStateChange,
    onTmuxExit: params.onTmuxExit,
    session,
  })

  return session
}

const toWebSocketUrl = (params: { instanceId: string; mode: TerminalMode }): string => {
  const encodedInstanceId = encodeURIComponent(params.instanceId)
  const encodedMode = encodeURIComponent(params.mode)
  const encodedToken = encodeURIComponent(window.tmuxCompanion.serverToken)

  return `ws://127.0.0.1:${String(window.tmuxCompanion.serverPort)}/pty/${encodedInstanceId}?mode=${encodedMode}&token=${encodedToken}`
}

const toWheelLines = (params: { event: WheelEvent; session: ITerminalSession }): number => {
  const rowHeight = params.session.element.clientHeight / params.session.terminal.rows

  if (rowHeight <= 0) {
    return 1
  }

  return Math.max(1, Math.round(Math.abs(params.event.deltaY) / rowHeight))
}

export const TerminalView = (props: {
  attachEpoch: number
  instanceId: string | null
  mode: TerminalMode
}): ReactElement => {
  const { attachEpoch, instanceId, mode } = props
  const { handleTmuxExit, registerTerminalController, setInstanceConnected, settings } = useInstances()
  const isGhosttyThemeImportEnabled = settings?.ghosttyThemeImport ?? false
  const [snapshot, setSnapshot] = useState<ITerminalConnectionSnapshot>({ isConnected: false, message: null })
  const [scrollbarSnapshot, setScrollbarSnapshot] = useState<ITerminalScrollbarSnapshot>({
    historySize: 0,
    isInCopyMode: false,
    rows: 0,
    scrollPosition: 0,
  })
  const [theme, setTheme] = useState<IGetThemeResponse | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const isSelectionDragActiveRef = useRef(false)
  const selectionPressPointRef = useRef<{ x: number; y: number } | null>(null)
  const sessionKeyRef = useRef<string | null>(null)
  const sessionsRef = useRef<Map<string, ITerminalSession>>(new Map())
  const themeRef = useRef<IGetThemeResponse | null>(null)

  useEffect(() => {
    if (instanceId === null) {
      sessionKeyRef.current = null

      return
    }

    sessionKeyRef.current = toSessionKey({ instanceId, mode })
  }, [instanceId, mode])

  useEffect(() => {
    themeRef.current = theme
  }, [theme])

  useEffect(() => {
    void new ApiClient()
      .getTheme()
      .then((fetchedTheme: IGetThemeResponse) => {
        setTheme(fetchedTheme)
      })
      .catch(() => {
        setTheme(null)
      })
  }, [isGhosttyThemeImportEnabled])

  useEffect(() => {
    sessionsRef.current.forEach((session) => {
      applySessionTheme({ session, theme })
    })
  }, [theme])

  const handleStateChange = useCallback((): void => {
    const currentSessionKey = sessionKeyRef.current

    if (currentSessionKey === null) {
      return
    }

    const session = sessionsRef.current.get(currentSessionKey)

    if (session === undefined) {
      return
    }

    setSnapshot(toConnectionSnapshot({ session }))
  }, [])

  const handleScrollStateChange = useCallback((params: { session: ITerminalSession }): void => {
    const currentSessionKey = sessionKeyRef.current

    if (currentSessionKey === null) {
      return
    }

    const sessionKey = toSessionKey({ instanceId: params.session.instanceId, mode: params.session.mode })

    if (sessionKey !== currentSessionKey) {
      return
    }

    const snapshot = toScrollbarSnapshot({ session: params.session })

    setScrollbarSnapshot((previous) => {
      if (isScrollbarSnapshotEqual({ next: snapshot, previous })) {
        return previous
      }

      return snapshot
    })
  }, [])

  const handleConnectedChange = useCallback(
    (params: { instanceId: string; isConnected: boolean }): void => {
      setInstanceConnected(params)
    },
    [setInstanceConnected],
  )

  useEffect(() => {
    return () => {
      sessionsRef.current.forEach((session) => {
        stopScrollStatePoll({ session })
        disconnectTerminalSession({ onScrollStateChange: handleScrollStateChange, session })
        session.terminal.dispose()
      })

      sessionsRef.current.clear()
    }
  }, [handleScrollStateChange])

  useEffect(() => {
    const unregisterTerminalController = registerTerminalController(
      (params: { instanceId: string; request: InstanceTerminalRequest }) => {
        sessionsRef.current.forEach((session, sessionKey) => {
          if (session.instanceId !== params.instanceId) {
            return
          }

          session.isConnected = false
          session.lastError = 'Disconnected'
          stopScrollStatePoll({ session })
          disconnectTerminalSession({ onScrollStateChange: handleScrollStateChange, session })

          if (params.request === 'dispose') {
            sessionsRef.current.delete(sessionKey)
            session.terminal.dispose()
          }
        })

        handleStateChange()
      },
    )

    return unregisterTerminalController
  }, [handleScrollStateChange, handleStateChange, registerTerminalController])

  useEffect(() => {
    const container = containerRef.current

    if (container === null || instanceId === null) {
      return
    }

    const sessionKey = toSessionKey({ instanceId, mode })
    const knownSession = sessionsRef.current.get(sessionKey)
    const session =
      knownSession ??
      toTerminalSession({
        instanceId,
        mode,
        onConnectedChange: handleConnectedChange,
        onScrollStateChange: handleScrollStateChange,
        onStateChange: handleStateChange,
        onTmuxExit: handleTmuxExit,
      })

    sessionsRef.current.set(sessionKey, session)
    container.replaceChildren(session.element)

    if (!session.isOpened) {
      session.isOpened = true
      session.terminal.open(session.element)
      terminalA11ySelectionUtil.registerSelectionMirrorClearing({ container: session.element })
    }

    applyTerminalSize({ session })
    scheduleTerminalFit({ session })
    focusTerminalSession({ session })

    const handleSelectionPressStart = (event: MouseEvent): void => {
      if (event.button !== 0) {
        return
      }

      clearA11ySelectionMirror({ session })

      // Plain presses bypass the (mouse-mode-disabled) selection service, so
      // a replayed selection would linger until the next drag.
      if (session.terminal.hasSelection()) {
        session.terminal.clearSelection()
      }

      selectionPressPointRef.current = { x: event.clientX, y: event.clientY }
    }

    const handleSelectionDragMove = (event: MouseEvent): void => {
      const pressPoint = selectionPressPointRef.current

      if (pressPoint === null || isSelectionDragActiveRef.current) {
        return
      }

      const deltaX = Math.abs(event.clientX - pressPoint.x)
      const deltaY = Math.abs(event.clientY - pressPoint.y)

      if (deltaX > TERMINAL_SELECTION_DRAG_THRESHOLD_PX || deltaY > TERMINAL_SELECTION_DRAG_THRESHOLD_PX) {
        isSelectionDragActiveRef.current = true
      }
    }

    const handleSelectionRelease = (event: MouseEvent): void => {
      const hasSelectionDragEnded = isSelectionDragActiveRef.current
      const pressPoint = selectionPressPointRef.current

      selectionPressPointRef.current = null
      isSelectionDragActiveRef.current = false

      if (event.button !== 0 || !hasSelectionDragEnded) {
        return
      }

      // A modifier-forced drag (Option/Shift) produced an xterm selection that
      // onSelectionChange already mirrored; asking tmux to copy could only
      // echo a stale buffer back over the mirror.
      if (session.terminal.hasSelection()) {
        return
      }

      if (pressPoint === null) {
        sendCopySelectionFrame({ session })

        return
      }

      const replayedSelection = replayPaneSwallowedSelection({
        from: pressPoint,
        session,
        to: { x: event.clientX, y: event.clientY },
      })

      sendCopySelectionFrame({ session, text: replayedSelection })
    }

    session.element.addEventListener('mousedown', handleSelectionPressStart)
    window.addEventListener('mousemove', handleSelectionDragMove)
    window.addEventListener('mouseup', handleSelectionRelease)

    if (knownSession === undefined) {
      applySessionTheme({ session, theme: themeRef.current })
    }

    if (knownSession !== undefined && isSessionReconnectable({ session: knownSession })) {
      connectTerminalSession({
        onConnectedChange: handleConnectedChange,
        onScrollStateChange: handleScrollStateChange,
        onStateChange: handleStateChange,
        onTmuxExit: handleTmuxExit,
        session: knownSession,
      })
    }

    setSnapshot(toConnectionSnapshot({ session }))
    setScrollbarSnapshot(toScrollbarSnapshot({ session }))

    if (session.mode === 'tmux' && session.isConnected) {
      queueScrollStatePoll({ delayMs: TERMINAL_SCROLL_STATE_SLOW_POLL_MS, session })
    }

    return () => {
      stopScrollStatePoll({ session })
      session.element.removeEventListener('mousedown', handleSelectionPressStart)
      window.removeEventListener('mousemove', handleSelectionDragMove)
      window.removeEventListener('mouseup', handleSelectionRelease)
      selectionPressPointRef.current = null
      isSelectionDragActiveRef.current = false
      session.element.remove()
    }
  }, [attachEpoch, handleConnectedChange, handleScrollStateChange, handleStateChange, handleTmuxExit, instanceId, mode])

  useEffect(() => {
    const container = containerRef.current

    if (container === null || instanceId === null) {
      return
    }

    const sessionKey = toSessionKey({ instanceId, mode })
    const resizeObserver = new ResizeObserver(() => {
      const session = sessionsRef.current.get(sessionKey)

      if (session === undefined) {
        return
      }

      applyTerminalSize({ session })
    })

    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
    }
  }, [instanceId, mode])

  const handleReconnect = (): void => {
    if (instanceId === null) {
      return
    }

    const session = sessionsRef.current.get(toSessionKey({ instanceId, mode }))

    if (session === undefined) {
      return
    }

    connectTerminalSession({
      onConnectedChange: handleConnectedChange,
      onScrollStateChange: handleScrollStateChange,
      onStateChange: handleStateChange,
      onTmuxExit: handleTmuxExit,
      session,
    })
  }

  const handleScrollbarScrollTo = (params: { direction: TerminalScrollDirection; lines: number }): void => {
    const currentSessionKey = sessionKeyRef.current

    if (currentSessionKey === null) {
      return
    }

    const session = sessionsRef.current.get(currentSessionKey)

    if (session === undefined) {
      return
    }

    sendScrollFrame({
      cursorKeys: toCursorKeys({ applicationCursorKeys: session.scrollState.applicationCursorKeys }),
      direction: params.direction,
      lines: params.lines,
      session,
    })
  }

  const handleScrollbarDragEnd = (): void => {
    const currentSessionKey = sessionKeyRef.current

    if (currentSessionKey === null) {
      return
    }

    const session = sessionsRef.current.get(currentSessionKey)

    if (session === undefined) {
      return
    }

    queueScrollStatePoll({ delayMs: TERMINAL_SCROLL_STATE_POLL_MS, session })
  }

  const resolveOverlayMessage = (): string => {
    if (instanceId === null) {
      return 'No instance selected'
    }

    return snapshot.message ?? 'Connecting...'
  }

  const renderReconnectButton = (): ReactElement | null => {
    if (instanceId === null) {
      return null
    }

    return (
      <button className="terminal-view-reconnect" onClick={handleReconnect} type="button">
        Reconnect
      </button>
    )
  }

  const renderOverlay = (): ReactElement | null => {
    if (snapshot.isConnected) {
      return null
    }

    return (
      <div className="terminal-view-overlay">
        <div className="terminal-view-overlay-message">{resolveOverlayMessage()}</div>
        {renderReconnectButton()}
      </div>
    )
  }

  const renderScrollbar = (): ReactElement | null => {
    if (mode !== 'tmux' || !snapshot.isConnected) {
      return null
    }

    return (
      <TerminalScrollbar
        historySize={scrollbarSnapshot.historySize}
        isInCopyMode={scrollbarSnapshot.isInCopyMode}
        onDragEnd={handleScrollbarDragEnd}
        onScrollTo={handleScrollbarScrollTo}
        position={scrollbarSnapshot.scrollPosition}
        rows={scrollbarSnapshot.rows}
      />
    )
  }

  return (
    <div className="terminal-view">
      <div className="terminal-view-terminal" ref={containerRef} />
      {renderScrollbar()}
      {renderOverlay()}
    </div>
  )
}
