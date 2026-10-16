import { type IUpdateCheckFailure, type UpdateCheckErrorKind } from '#src/shared/api-model'

const GITHUB_STATUS_NOT_FOUND = 404

const RATE_LIMITED_REMAINING = '0'

const RATE_LIMITED_STATUS = 403

const RATE_LIMIT_REMAINING_HEADER = 'x-ratelimit-remaining'

const RATE_LIMIT_RESET_HEADER = 'x-ratelimit-reset'

const TIMEOUT_ERROR_NAMES = ['AbortError', 'TimeoutError']

export const updateCheckErrorUtil = {
  toFailureFromResponse: (params: { response: Response }): IUpdateCheckFailure => {
    const { response } = params

    return updateCheckErrorUtil.toResponseFailure({
      httpStatusCode: response.status,
      rateLimitRemaining: response.headers.get(RATE_LIMIT_REMAINING_HEADER),
      rateLimitResetEpochMs: updateCheckErrorUtil.toResetEpochMs({
        resetSeconds: response.headers.get(RATE_LIMIT_RESET_HEADER),
      }),
    })
  },

  toFailureFromThrown: (params: { error: unknown }): IUpdateCheckFailure => {
    const { error } = params

    if (!(error instanceof Error)) {
      return updateCheckErrorUtil.toUnknownFailure({ error })
    }

    return {
      httpStatusCode: null,
      kind: updateCheckErrorUtil.toThrownKind({ errorName: error.name }),
      message: error.message,
      rateLimitResetEpochMs: null,
    }
  },

  toRateLimitedUserMessage: (params: { failure: IUpdateCheckFailure }): string => {
    const { failure } = params

    if (failure.rateLimitResetEpochMs === null) {
      return 'GitHub API rate limit exceeded'
    }

    const resetTimeText = new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      hour12: false,
      minute: '2-digit',
    }).format(failure.rateLimitResetEpochMs)

    return `GitHub API rate limit exceeded — resets at ${resetTimeText}`
  },

  toResetEpochMs: (params: { resetSeconds: string | null }): number | null => {
    const { resetSeconds } = params

    if (resetSeconds === null) {
      return null
    }

    const resetSecondsNumber = Number.parseInt(resetSeconds, 10)

    if (Number.isNaN(resetSecondsNumber)) {
      return null
    }

    return resetSecondsNumber * 1000
  },

  toResponseFailure: (params: {
    httpStatusCode: number
    rateLimitRemaining: string | null
    rateLimitResetEpochMs: number | null
  }): IUpdateCheckFailure => {
    const { httpStatusCode, rateLimitRemaining, rateLimitResetEpochMs } = params
    const message = `GitHub release check failed with status ${String(httpStatusCode)}`

    if (httpStatusCode === RATE_LIMITED_STATUS && rateLimitRemaining === RATE_LIMITED_REMAINING) {
      return { httpStatusCode, kind: 'rate-limited', message, rateLimitResetEpochMs }
    }

    return { httpStatusCode, kind: 'http-error', message, rateLimitResetEpochMs: null }
  },

  toThrownKind: (params: { errorName: string }): UpdateCheckErrorKind => {
    const { errorName } = params

    if (TIMEOUT_ERROR_NAMES.includes(errorName)) {
      return 'timeout'
    }

    if (errorName === 'SyntaxError') {
      return 'invalid-response'
    }

    if (errorName === 'TypeError') {
      return 'network'
    }

    return 'unknown'
  },

  toUnknownFailure: (params: { error: unknown }): IUpdateCheckFailure => {
    const { error } = params

    if (error instanceof Error) {
      return { httpStatusCode: null, kind: 'unknown', message: error.message, rateLimitResetEpochMs: null }
    }

    return { httpStatusCode: null, kind: 'unknown', message: String(error), rateLimitResetEpochMs: null }
  },

  toUserMessage: (params: { failure: IUpdateCheckFailure }): string => {
    const { failure } = params

    switch (failure.kind) {
      case 'http-error': {
        if (failure.httpStatusCode === GITHUB_STATUS_NOT_FOUND) {
          return 'No GitHub release published yet for this project'
        }

        return `GitHub request failed with status ${String(failure.httpStatusCode)}`
      }
      case 'invalid-response': {
        return 'GitHub returned an unexpected response'
      }
      case 'network': {
        return 'Network error — check your connection'
      }
      case 'rate-limited': {
        return updateCheckErrorUtil.toRateLimitedUserMessage({ failure })
      }
      case 'timeout': {
        return 'Request timed out'
      }
      default: {
        return failure.message
      }
    }
  },
}
