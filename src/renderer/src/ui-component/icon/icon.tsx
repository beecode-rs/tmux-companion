import { type ReactElement, type ReactNode } from 'react'

export type IconName =
  'copy' | 'menu' | 'monitor' | 'pencil' | 'plus' | 'power' | 'refresh' | 'rotate' | 'servers' | 'trash' | 'x'

const renderIconShape = (params: { name: IconName }): ReactNode => {
  switch (params.name) {
    case 'copy': {
      return (
        <>
          <rect height="13" rx="2" ry="2" width="13" x="9" y="9" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </>
      )
    }

    case 'menu': {
      return (
        <>
          <line x1="3" x2="21" y1="6" y2="6" />
          <line x1="3" x2="21" y1="12" y2="12" />
          <line x1="3" x2="21" y1="18" y2="18" />
        </>
      )
    }

    case 'monitor': {
      return (
        <>
          <rect height="14" rx="2" ry="2" width="20" x="2" y="3" />
          <line x1="8" x2="16" y1="21" y2="21" />
          <line x1="12" x2="12" y1="17" y2="21" />
        </>
      )
    }

    case 'pencil': {
      return <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    }

    case 'plus': {
      return (
        <>
          <line x1="12" x2="12" y1="5" y2="19" />
          <line x1="5" x2="19" y1="12" y2="12" />
        </>
      )
    }

    case 'power': {
      return (
        <>
          <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
          <line x1="12" x2="12" y1="2" y2="12" />
        </>
      )
    }

    case 'refresh': {
      return (
        <>
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </>
      )
    }

    case 'rotate': {
      return (
        <>
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </>
      )
    }

    case 'servers': {
      return (
        <>
          <rect height="8" rx="2" ry="2" width="20" x="2" y="2" />
          <rect height="8" rx="2" ry="2" width="20" x="2" y="14" />
          <line x1="6" x2="6.01" y1="6" y2="6" />
          <line x1="6" x2="6.01" y1="18" y2="18" />
        </>
      )
    }

    case 'trash': {
      return (
        <>
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <line x1="10" x2="10" y1="11" y2="17" />
          <line x1="14" x2="14" y1="11" y2="17" />
        </>
      )
    }

    case 'x': {
      return (
        <>
          <line x1="18" x2="6" y1="6" y2="18" />
          <line x1="6" x2="18" y1="6" y2="18" />
        </>
      )
    }
  }
}

export const Icon = (props: { name: IconName }): ReactElement => {
  const { name } = props

  return (
    <svg
      fill="none"
      height="24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="24"
    >
      {renderIconShape({ name })}
    </svg>
  )
}
