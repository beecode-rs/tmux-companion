const SESSION_NAME_PATTERN = /^[A-Za-z0-9_-]{1,40}$/

const DEFAULT_SESSION_NAME_PATTERN = /^s(\d+)$/

const TRAILING_NUMBER_PATTERN = /(\d+)$/

const WHOLE_NUMBER_PATTERN = /^\d+$/

export const sessionNamingUtil = {
  toCloneSessionName: (params: { names: string[]; sourceName: string }): string => {
    const { names, sourceName } = params
    const match = TRAILING_NUMBER_PATTERN.exec(sourceName)
    const trailingNumber = match?.[1] ?? ''
    const prefix = sourceName.slice(0, sourceName.length - trailingNumber.length)
    const startNumber = (Number.parseInt(trailingNumber, 10) || 0) + 1
    const minWidth = trailingNumber.length || 2
    const takenNumbers = names
      .filter((existingName) => {
        return existingName.startsWith(prefix) && WHOLE_NUMBER_PATTERN.test(existingName.slice(prefix.length))
      })
      .map((existingName) => {
        return Number.parseInt(existingName.slice(prefix.length), 10)
      })
      .sort((left, right) => {
        return left - right
      })
    const nextNumber = takenNumbers.reduce((candidate, takenNumber) => {
      if (takenNumber > candidate) {
        return candidate
      }

      return takenNumber + 1
    }, startNumber)

    return `${prefix}${String(nextNumber).padStart(minWidth, '0')}`
  },

  toNextSessionName: (params: { names: string[] }): string => {
    const maxNumber = params.names.reduce((accumulator, name) => {
      const match = DEFAULT_SESSION_NAME_PATTERN.exec(name)

      if (match === null) {
        return accumulator
      }

      return Math.max(accumulator, Number.parseInt(match[1] ?? '0', 10))
    }, 0)

    return `s${String(maxNumber + 1).padStart(2, '0')}`
  },

  validateSessionName: (value: string): string | null => {
    if (value === '') {
      return 'Session name cannot be empty'
    }

    if (value.includes('.') || value.includes(':')) {
      return "Session names cannot contain '.' or ':'"
    }

    if (!SESSION_NAME_PATTERN.test(value)) {
      return 'Session name must be 1-40 characters (letters, numbers, _ and -)'
    }

    return null
  },
}
