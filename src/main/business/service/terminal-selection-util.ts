export interface ITerminalSelectionBufferRow {
  createdEpochSeconds: number
  name: string
}

export const terminalSelectionUtil = {
  toBufferRows(params: { stdout: string }): ITerminalSelectionBufferRow[] {
    return params.stdout
      .split('\n')
      .map((line) => {
        const fields = line.split('\t')
        const createdEpochSeconds = Number(fields[0])
        const name = fields[1] ?? ''

        if (!Number.isInteger(createdEpochSeconds) || createdEpochSeconds <= 0 || name === '') {
          return null
        }

        return { createdEpochSeconds, name }
      })
      .filter((row) => {
        return row !== null
      })
  },

  toClipboardText(params: { raw: string }): string {
    if (params.raw.endsWith('\n')) {
      return params.raw.slice(0, -1)
    }

    return params.raw
  },

  toNewestRecentBufferName(params: {
    minCreatedEpochSeconds: number
    rows: ITerminalSelectionBufferRow[]
  }): string | null {
    const recentRows = params.rows.filter((row) => {
      return row.createdEpochSeconds >= params.minCreatedEpochSeconds
    })

    const newestRow = recentRows.reduce<ITerminalSelectionBufferRow | null>((champion, challenger) => {
      if (champion !== null && champion.createdEpochSeconds >= challenger.createdEpochSeconds) {
        return champion
      }

      return challenger
    }, null)

    return newestRow?.name ?? null
  },
}
