import {
  type IApiErrorBody,
  type ICloneSessionRequest,
  type ICreateInstanceRequest,
  type ICreateSessionRequest,
  type IGetThemeResponse,
  type IInstanceResponse,
  type IListInstancesResponse,
  type IListSessionsResponse,
  type IRenameSessionRequest,
  type ISessionNameResponse,
  type ISwitchSessionResponse,
  type ITerminalListResult,
  type ITerminalSettingRequest,
  type ITerminalSettingResponse,
  type ITestConnectionRequest,
  type ITestConnectionResponse,
  type IUpdateInstanceRequest,
  type IUpdateSettingsRequest,
} from '#src/shared/api-model'
import { type IAppSettings } from '#src/shared/settings-model'

const API_BASE_URL = 'http://127.0.0.1'

export class ApiClient {
  cloneSession(
    params: { instanceId: string; sourceName: string } & ICloneSessionRequest,
  ): Promise<ISessionNameResponse> {
    return this._requestJson({
      body: { name: params.name },
      method: 'POST',
      path: this._toSessionActionPath({ action: 'clone', instanceId: params.instanceId, name: params.sourceName }),
    })
  }

  createInstance(params: ICreateInstanceRequest): Promise<IInstanceResponse> {
    return this._requestJson({ body: params, method: 'POST', path: '/api/instances' })
  }

  createSession(params: { instanceId: string } & ICreateSessionRequest): Promise<ISessionNameResponse> {
    return this._requestJson({
      body: { name: params.name },
      method: 'POST',
      path: this._toSessionsPath({ instanceId: params.instanceId }),
    })
  }

  deleteInstance(params: { id: string; killSessions: boolean }): Promise<void> {
    const killSessionsQuery = `killSessions=${String(params.killSessions)}`

    return this._requestVoid({
      method: 'DELETE',
      path: `/api/instances/${encodeURIComponent(params.id)}?${killSessionsQuery}`,
    })
  }

  deleteSession(params: { instanceId: string; name: string }): Promise<void> {
    return this._requestVoid({ method: 'DELETE', path: this._toSessionPath(params) })
  }

  disconnectInstance(params: { id: string }): Promise<void> {
    return this._requestVoid({
      method: 'POST',
      path: `/api/instances/${encodeURIComponent(params.id)}/disconnect`,
    })
  }

  getSettings(): Promise<IAppSettings> {
    return this._requestJson({ method: 'GET', path: '/api/settings' })
  }

  getTheme(): Promise<IGetThemeResponse> {
    return this._requestJson({ method: 'GET', path: '/api/theme' })
  }

  listInstances(): Promise<IListInstancesResponse> {
    return this._requestJson({ method: 'GET', path: '/api/instances' })
  }

  listSessions(params: { instanceId: string }): Promise<IListSessionsResponse> {
    return this._requestJson({
      method: 'GET',
      path: this._toSessionsPath({ instanceId: params.instanceId }),
    })
  }

  listTerminals(): Promise<ITerminalListResult> {
    return this._requestJson({ method: 'GET', path: '/api/terminals' })
  }

  openExternalSession(params: { instanceId: string; name: string }): Promise<void> {
    return this._requestVoid({
      method: 'POST',
      path: this._toSessionActionPath({ action: 'open-external', ...params }),
    })
  }

  renameSession(params: { currentName: string; instanceId: string; nextName: string }): Promise<ISessionNameResponse> {
    return this._requestJson({
      body: { name: params.nextName },
      method: 'PATCH',
      path: this._toSessionPath({ instanceId: params.instanceId, name: params.currentName }),
    })
  }

  switchSession(params: { instanceId: string; name: string }): Promise<ISwitchSessionResponse> {
    return this._requestJson({
      method: 'POST',
      path: this._toSessionActionPath({ action: 'switch', ...params }),
    })
  }

  testConnection(params: ITestConnectionRequest): Promise<ITestConnectionResponse> {
    return this._requestJson({ body: params, method: 'POST', path: '/api/connection-tests' })
  }

  updateInstance(params: { id: string } & IUpdateInstanceRequest): Promise<IInstanceResponse> {
    return this._requestJson({
      body: { label: params.label, ssh: params.ssh },
      method: 'PATCH',
      path: `/api/instances/${encodeURIComponent(params.id)}`,
    })
  }

  updateSettings(params: IUpdateSettingsRequest): Promise<IAppSettings> {
    return this._requestJson({ body: params, method: 'PUT', path: '/api/settings' })
  }

  updateTerminalSetting(params: ITerminalSettingRequest): Promise<ITerminalSettingResponse> {
    return this._requestJson({ body: params, method: 'PUT', path: '/api/settings/terminal' })
  }

  protected async _requestJson<T>(params: { body?: unknown; method: string; path: string }): Promise<T> {
    const response = await this._toResponse(params)

    return (await response.json()) as T
  }

  protected async _requestVoid(params: { body?: unknown; method: string; path: string }): Promise<void> {
    await this._toResponse(params)
  }

  protected async _toErrorMessage(params: { response: Response }): Promise<string> {
    const fallbackMessage = `Request failed with status ${String(params.response.status)}`

    try {
      const body = (await params.response.json()) as Partial<IApiErrorBody>

      return body.message ?? fallbackMessage
    } catch {
      return fallbackMessage
    }
  }

  protected _toHeaders(): Headers {
    const headers = new Headers()

    headers.append('Authorization', `Bearer ${window.tmuxCompanion.serverToken}`)
    headers.append('Content-Type', 'application/json')

    return headers
  }

  protected _toRequestBody(params: { body?: unknown }): string | undefined {
    if (params.body === undefined) {
      return undefined
    }

    return JSON.stringify(params.body)
  }

  protected async _toResponse(params: { body?: unknown; method: string; path: string }): Promise<Response> {
    const response = await fetch(this._toUrl({ path: params.path }), {
      body: this._toRequestBody({ body: params.body }),
      headers: this._toHeaders(),
      method: params.method,
    })

    if (!response.ok) {
      throw new Error(await this._toErrorMessage({ response }))
    }

    return response
  }

  protected _toSessionActionPath(params: { action: string; instanceId: string; name: string }): string {
    return `${this._toSessionPath({ instanceId: params.instanceId, name: params.name })}/${params.action}`
  }

  protected _toSessionPath(params: { instanceId: string; name: string }): string {
    const encodedInstanceId = encodeURIComponent(params.instanceId)
    const encodedName = encodeURIComponent(params.name)

    return `/api/instances/${encodedInstanceId}/sessions/${encodedName}`
  }

  protected _toSessionsPath(params: { instanceId: string }): string {
    const encodedInstanceId = encodeURIComponent(params.instanceId)

    return `/api/instances/${encodedInstanceId}/sessions`
  }

  protected _toUrl(params: { path: string }): string {
    return `${API_BASE_URL}:${String(window.tmuxCompanion.serverPort)}${params.path}`
  }
}
