import { type ReactElement, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react'

import { terminalScrollbarUtil } from '#src/renderer/src/ui-component/terminal-view/terminal-scrollbar-util'
import { type TerminalScrollDirection } from '#src/shared/terminal-scroll-model'

import '#src/renderer/src/ui-component/terminal-view/terminal-view.css'

const TERMINAL_SCROLLBAR_DRAG_FLUSH_MS = 40

const TERMINAL_SCROLLBAR_MIN_THUMB_PX = 24

export const TerminalScrollbar = (props: {
  historySize: number
  isInCopyMode: boolean
  onDragEnd: () => void
  onScrollTo: (params: { direction: TerminalScrollDirection; lines: number }) => void
  position: number
  rows: number
}): ReactElement => {
  const { historySize, isInCopyMode, onDragEnd, onScrollTo, position, rows } = props
  const [dragPosition, setDragPosition] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [trackHeightPx, setTrackHeightPx] = useState(0)
  const dragFlushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastDragSendAtRef = useRef(0)
  const lastSentPositionRef = useRef(0)
  const pendingDragTargetRef = useRef<number | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const track = trackRef.current

    if (track === null) {
      return
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]

      if (entry !== undefined) {
        setTrackHeightPx(entry.contentRect.height)
      }
    })

    resizeObserver.observe(track)

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  useEffect(() => {
    return () => {
      if (dragFlushTimeoutRef.current !== null) {
        clearTimeout(dragFlushTimeoutRef.current)
      }
    }
  }, [])

  const resolveRenderedPosition = (): number => {
    if (isDragging) {
      return dragPosition
    }

    return position
  }

  const geometry = terminalScrollbarUtil.toThumbGeometry({
    historySize,
    minThumbPx: TERMINAL_SCROLLBAR_MIN_THUMB_PX,
    position: resolveRenderedPosition(),
    rows,
    trackHeightPx,
  })

  const resolveTrackClassName = (): string => {
    const classNames = ['terminal-view-scrollbar']

    if (isInCopyMode && historySize > 0) {
      classNames.push('is-visible')
    }

    if (isDragging) {
      classNames.push('is-dragging')
    }

    return classNames.join(' ')
  }

  const resolvePointerTopPx = (params: { clientY: number }): number => {
    const track = trackRef.current

    if (track === null) {
      return 0
    }

    return params.clientY - track.getBoundingClientRect().top
  }

  const resolvePointerTarget = (params: { clientY: number }): number => {
    return terminalScrollbarUtil.toTrackPosition({
      historySize,
      pointerTopPx: resolvePointerTopPx({ clientY: params.clientY }),
      thumbHeightPx: geometry.thumbHeightPx,
      trackHeightPx,
    })
  }

  const sendDragScroll = (params: { target: number }): void => {
    const dragScroll = terminalScrollbarUtil.toDragScroll({
      fromPosition: lastSentPositionRef.current,
      toPosition: params.target,
    })

    if (dragScroll !== null) {
      onScrollTo(dragScroll)
    }

    lastSentPositionRef.current = params.target
    lastDragSendAtRef.current = Date.now()
  }

  const scheduleDragScroll = (params: { target: number }): void => {
    pendingDragTargetRef.current = params.target

    if (dragFlushTimeoutRef.current !== null) {
      return
    }

    dragFlushTimeoutRef.current = setTimeout(() => {
      dragFlushTimeoutRef.current = null
      const pendingTarget = pendingDragTargetRef.current

      if (pendingTarget !== null) {
        pendingDragTargetRef.current = null
        sendDragScroll({ target: pendingTarget })
      }
    }, TERMINAL_SCROLLBAR_DRAG_FLUSH_MS)
  }

  const beginDrag = (params: { fromPosition: number; pointerId: number; target: HTMLElement }): void => {
    setDragPosition(params.fromPosition)
    setIsDragging(true)
    lastSentPositionRef.current = params.fromPosition
    lastDragSendAtRef.current = 0
    pendingDragTargetRef.current = null
    params.target.setPointerCapture(params.pointerId)
  }

  const handleThumbPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    beginDrag({ fromPosition: position, pointerId: event.pointerId, target: event.currentTarget })
  }

  const handleTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) {
      return
    }

    event.preventDefault()

    const target = resolvePointerTarget({ clientY: event.clientY })

    beginDrag({ fromPosition: position, pointerId: event.pointerId, target: event.currentTarget })
    sendDragScroll({ target })
  }

  const handleDragPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!isDragging) {
      return
    }

    const target = resolvePointerTarget({ clientY: event.clientY })

    setDragPosition(target)

    if (Date.now() - lastDragSendAtRef.current >= TERMINAL_SCROLLBAR_DRAG_FLUSH_MS) {
      sendDragScroll({ target })

      return
    }

    scheduleDragScroll({ target })
  }

  const handleDragPointerEnd = (): void => {
    if (!isDragging) {
      return
    }

    const pendingTarget = pendingDragTargetRef.current

    if (pendingTarget !== null) {
      pendingDragTargetRef.current = null
      sendDragScroll({ target: pendingTarget })
    }

    if (dragFlushTimeoutRef.current !== null) {
      clearTimeout(dragFlushTimeoutRef.current)
      dragFlushTimeoutRef.current = null
    }

    setIsDragging(false)
    onDragEnd()
  }

  return (
    <div
      className={resolveTrackClassName()}
      onPointerCancel={handleDragPointerEnd}
      onPointerDown={handleTrackPointerDown}
      onPointerMove={handleDragPointerMove}
      onPointerUp={handleDragPointerEnd}
      ref={trackRef}
    >
      <div
        className="terminal-view-scrollbar-thumb"
        onPointerCancel={handleDragPointerEnd}
        onPointerDown={handleThumbPointerDown}
        onPointerMove={handleDragPointerMove}
        onPointerUp={handleDragPointerEnd}
        style={{ height: `${String(geometry.thumbHeightPx)}px`, top: `${String(geometry.thumbTopPx)}px` }}
      />
    </div>
  )
}
