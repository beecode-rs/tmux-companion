import { type ISessionInfo } from '#src/shared/session-model'

export interface ITmuxClientRow {
  activity: number
  session: string
  tty: string
}

export interface ITmuxSessionRow {
  attachedCount: number
  lastAttached: number
  name: string
  windows: number
}

export type ITmuxKillPlan = { name: string; type: 'switch' } | { type: 'terminate' }

export interface ITmuxPaneScrollState {
  historySize: number
  isAlternateOn: boolean
  isInCopyMode: boolean
  scrollPosition: number
}

const CONTROL_NOTIFICATION_SESSIONS_CHANGED = '%sessions-changed'

const CONTROL_NOTIFICATION_SESSION_RENAMED = '%session-renamed'

const NO_CLIENTS_SENTINELS = ['no clients', 'no server running']

const NO_SESSIONS_SENTINELS = ['no server running', 'no sessions']

export const tmuxParseUtil = {
  _isAbsentOutput(params: { sentinels: readonly string[]; stderr: string }): boolean {
    return params.sentinels.some((sentinel) => {
      return params.stderr.includes(sentinel)
    })
  },

  _sortByMostRecent(params: { rows: ITmuxSessionRow[] }): ITmuxSessionRow[] {
    return [...params.rows].sort((left, right) => {
      if (left.lastAttached !== right.lastAttached) {
        return right.lastAttached - left.lastAttached
      }

      return left.name.localeCompare(right.name)
    })
  },

  _toActiveSessionName(params: { activeSessionName: string | null; rows: ITmuxSessionRow[] }): string | null {
    if (params.activeSessionName !== null) {
      const isClientSessionOwned = params.rows.some((row) => {
        return row.name === params.activeSessionName
      })

      if (isClientSessionOwned) {
        return params.activeSessionName
      }
    }

    const mostRecentRow = params.rows[0]

    if (mostRecentRow === undefined || mostRecentRow.lastAttached <= 0) {
      return null
    }

    return mostRecentRow.name
  },

  _toClientRow(params: { line: string }): ITmuxClientRow | null {
    const fields = params.line.split('\t')

    if (fields.length !== 3) {
      return null
    }

    const tty = fields[0] ?? ''

    if (tty === '') {
      return null
    }

    return {
      activity: tmuxParseUtil._toNumericValue({ value: fields[2] ?? '' }),
      session: fields[1] ?? '',
      tty,
    }
  },

  _toLines(params: { stdout: string }): string[] {
    return params.stdout.split('\n').filter((line) => {
      return line !== ''
    })
  },

  _toNumericValue(params: { value: string }): number {
    const parsedValue = Number.parseInt(params.value, 10)

    if (Number.isNaN(parsedValue)) {
      return 0
    }

    return parsedValue
  },

  _toSessionRow(params: { line: string }): ITmuxSessionRow | null {
    const fields = params.line.split('\t')

    if (fields.length !== 4) {
      return null
    }

    return {
      attachedCount: tmuxParseUtil._toNumericValue({ value: fields[2] ?? '' }),
      lastAttached: tmuxParseUtil._toNumericValue({ value: fields[3] ?? '' }),
      name: fields[0] ?? '',
      windows: tmuxParseUtil._toNumericValue({ value: fields[1] ?? '' }),
    }
  },

  isAbsentClientOutput(params: { stderr: string }): boolean {
    return tmuxParseUtil._isAbsentOutput({ sentinels: NO_CLIENTS_SENTINELS, stderr: params.stderr })
  },

  isAbsentSessionOutput(params: { stderr: string }): boolean {
    return tmuxParseUtil._isAbsentOutput({ sentinels: NO_SESSIONS_SENTINELS, stderr: params.stderr })
  },

  isControlRefreshNotification(params: { line: string }): boolean {
    const notificationName = params.line.split(' ')[0]

    return (
      notificationName === CONTROL_NOTIFICATION_SESSIONS_CHANGED ||
      notificationName === CONTROL_NOTIFICATION_SESSION_RENAMED
    )
  },

  parseClientOutput(params: { stderr: string; stdout: string }): ITmuxClientRow[] {
    if (tmuxParseUtil._isAbsentOutput({ sentinels: NO_CLIENTS_SENTINELS, stderr: params.stderr })) {
      return []
    }

    return tmuxParseUtil
      ._toLines({ stdout: params.stdout })
      .map((line) => {
        return tmuxParseUtil._toClientRow({ line })
      })
      .filter((row): row is ITmuxClientRow => {
        return row !== null
      })
  },

  parsePaneScrollState(params: { stdout: string }): ITmuxPaneScrollState | null {
    const line = tmuxParseUtil._toLines({ stdout: params.stdout })[0]

    if (line === undefined) {
      return null
    }

    const fields = line.split('\t')

    if (fields.length !== 4) {
      return null
    }

    return {
      historySize: tmuxParseUtil._toNumericValue({ value: fields[3] ?? '' }),
      isAlternateOn: fields[0] === '1',
      isInCopyMode: fields[1] === '1',
      scrollPosition: tmuxParseUtil._toNumericValue({ value: fields[2] ?? '' }),
    }
  },

  parseSessionOutput(params: { stderr: string; stdout: string }): ITmuxSessionRow[] {
    if (tmuxParseUtil._isAbsentOutput({ sentinels: NO_SESSIONS_SENTINELS, stderr: params.stderr })) {
      return []
    }

    return tmuxParseUtil
      ._toLines({ stdout: params.stdout })
      .map((line) => {
        return tmuxParseUtil._toSessionRow({ line })
      })
      .filter((row): row is ITmuxSessionRow => {
        return row !== null
      })
  },

  toClientSessionName(params: { clientRows: ITmuxClientRow[]; clientTty: string }): string | null {
    return (
      params.clientRows.find((row) => {
        return row.tty === params.clientTty
      })?.session ?? null
    )
  },

  toClientTty(params: { clientRows: ITmuxClientRow[]; sessionName: string }): string | null {
    const startSessionRows = params.clientRows.filter((row) => {
      return row.session === params.sessionName
    })
    const mostRecentRow = [...startSessionRows].sort((left, right) => {
      return right.activity - left.activity
    })[0]

    return mostRecentRow?.tty ?? null
  },

  toKillPlan(params: { rows: ITmuxSessionRow[]; victimName: string }): ITmuxKillPlan {
    const otherRows = tmuxParseUtil._sortByMostRecent({
      rows: params.rows.filter((row) => {
        return row.name !== params.victimName
      }),
    })
    const mostRecentOther = otherRows[0]

    if (mostRecentOther !== undefined) {
      return { name: mostRecentOther.name, type: 'switch' }
    }

    return { type: 'terminate' }
  },

  toSessionInfos(params: { activeSessionName?: string | null; rows: ITmuxSessionRow[] }): ISessionInfo[] {
    const activeSessionName = tmuxParseUtil._toActiveSessionName({
      activeSessionName: params.activeSessionName ?? null,
      rows: tmuxParseUtil._sortByMostRecent({ rows: params.rows }),
    })

    return params.rows
      .map((row) => {
        return {
          active: row.name === activeSessionName,
          attached: row.attachedCount > 0,
          name: row.name,
          windows: row.windows,
        }
      })
      .sort((left, right) => {
        return left.name.localeCompare(right.name)
      })
  },
}
