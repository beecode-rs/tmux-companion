export const appTitleUtil = {
  resolve(params: { isDev: boolean }): string {
    const { isDev } = params

    if (isDev) {
      return 'Tmux Companion (dev)'
    }

    return 'Tmux Companion'
  },
}
