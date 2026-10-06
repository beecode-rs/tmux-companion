export const errorMessageUtil = {
  toMessage(params: { error: unknown }): string {
    if (params.error instanceof Error) {
      return params.error.message
    }

    return String(params.error)
  },
}
