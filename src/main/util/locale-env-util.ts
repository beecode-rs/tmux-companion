const FALLBACK_UTF8_LOCALE = 'en_US.UTF-8'

const LOCALE_ENV_KEYS = ['LC_ALL', 'LC_CTYPE', 'LANG']

const UTF8_LOCALE_PATTERN = /utf-?8/i

export class LocaleEnvUtil {
  applyToProcessEnv(): void {
    if (UTF8_LOCALE_PATTERN.test(this._toEffectiveLocale())) {
      return
    }

    process.env.LANG = FALLBACK_UTF8_LOCALE
  }

  protected _toEffectiveLocale(): string {
    const locale = LOCALE_ENV_KEYS.map((key) => {
      return process.env[key]
    }).find((value) => {
      return value !== undefined && value !== ''
    })

    return locale ?? ''
  }
}
