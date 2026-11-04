export const APP_URL_SCHEME = 'tmux-companion'

const FOCUS_HOST = 'focus'

const PORT_MIN = 1

const PORT_MAX = 65_535

export interface IDeepLinkFocusParams {
  host?: string
  port?: number
  sessionName: string
  user?: string
}

export const deepLinkUtil = {
  buildFocusUrl: (params: IDeepLinkFocusParams): string => {
    const searchParams = new URLSearchParams({ session: params.sessionName })

    if (params.host !== undefined) {
      searchParams.set('host', params.host)
    }

    if (params.port !== undefined) {
      searchParams.set('port', String(params.port))
    }

    if (params.user !== undefined) {
      searchParams.set('user', params.user)
    }

    return `${APP_URL_SCHEME}://${FOCUS_HOST}?${searchParams.toString()}`
  },

  parseFocusUrl: (url: string): IDeepLinkFocusParams | null => {
    if (!url.startsWith(`${APP_URL_SCHEME}://`)) {
      return null
    }

    const parsedUrl = deepLinkUtil.toParsedUrl({ url })

    if (parsedUrl?.hostname !== FOCUS_HOST) {
      return null
    }

    const sessionName = parsedUrl.searchParams.get('session') ?? ''

    if (sessionName === '') {
      return null
    }

    return {
      host: deepLinkUtil.toOptionalParam({ key: 'host', parsedUrl }),
      port: deepLinkUtil.toOptionalPort({ parsedUrl }),
      sessionName,
      user: deepLinkUtil.toOptionalParam({ key: 'user', parsedUrl }),
    }
  },

  toOptionalParam: (params: { key: 'host' | 'user'; parsedUrl: URL }): string | undefined => {
    const value = params.parsedUrl.searchParams.get(params.key) ?? ''

    if (value === '') {
      return undefined
    }

    return value
  },

  toOptionalPort: (params: { parsedUrl: URL }): number | undefined => {
    const port = Number(params.parsedUrl.searchParams.get('port'))

    if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) {
      return undefined
    }

    return port
  },

  toParsedUrl: (params: { url: string }): URL | null => {
    try {
      return new URL(params.url)
    } catch {
      return null
    }
  },
}
