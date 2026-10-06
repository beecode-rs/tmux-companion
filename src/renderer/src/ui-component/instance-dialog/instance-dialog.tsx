import { type ReactElement, useState } from 'react'

import { ApiClient } from '#src/renderer/src/business/service/api-client'
import { errorMessageUtil } from '#src/renderer/src/util/error-message-util'
import { type IInstanceResponse } from '#src/shared/api-model'
import { instanceLabelUtil } from '#src/shared/instance-label-util'
import { type IInstance, type IInstanceSshConfig, type InstanceType } from '#src/shared/instance-model'

import '#src/renderer/src/ui-component/instance-dialog/instance-dialog.css'

interface IInstanceDialogProps {
  instance: IInstance | null
  instances: IInstance[]
  onClose: () => void
  onSaved: (params: { instance: IInstance }) => void
}

interface IDialogFormState {
  host: string
  identityFile: string
  label: string
  port: string
  user: string
}

interface ITestConnectionState {
  isError: boolean
  message: string
}

const resolveDialogTitle = (params: { isEditMode: boolean }): string => {
  if (params.isEditMode) {
    return 'Edit instance'
  }

  return 'New remote instance'
}

const resolveSaveButtonLabel = (params: { isEditMode: boolean }): string => {
  if (params.isEditMode) {
    return 'Save'
  }

  return 'Create'
}

const resolveTestButtonLabel = (params: { isTesting: boolean }): string => {
  if (params.isTesting) {
    return 'Testing...'
  }

  return 'Test connection'
}

const resolveHostError = (params: { type: InstanceType; value: string }): string | null => {
  if (params.type !== 'ssh') {
    return null
  }

  if (params.value.trim() === '') {
    return 'SSH instances require a host'
  }

  return null
}

const resolvePortError = (params: { value: string }): string | null => {
  if (params.value === '') {
    return null
  }

  const portNumber = Number(params.value)

  if (Number.isInteger(portNumber) && portNumber > 0) {
    return null
  }

  return 'Port must be a positive number'
}

const resolveTestResultClassName = (params: { isError: boolean }): string => {
  if (params.isError) {
    return 'instance-dialog-test-result is-error'
  }

  return 'instance-dialog-test-result is-success'
}

const toInitialPort = (params: { instance: IInstance | null }): string => {
  const port = params.instance?.ssh?.port

  if (port === undefined) {
    return ''
  }

  return String(port)
}

const resolveInstanceType = (params: { instance: IInstance | null }): InstanceType => {
  return params.instance?.type ?? 'ssh'
}

const toInitialFormState = (params: { instance: IInstance | null }): IDialogFormState => {
  return {
    host: params.instance?.ssh?.host ?? '',
    identityFile: params.instance?.ssh?.identityFile ?? '',
    label: params.instance?.label ?? '',
    port: toInitialPort({ instance: params.instance }),
    user: params.instance?.ssh?.user ?? '',
  }
}

const toOptionalStringValue = (params: { value: string }): string | undefined => {
  if (params.value === '') {
    return undefined
  }

  return params.value
}

const toPortRequestValue = (params: { value: string }): number | undefined => {
  if (params.value === '') {
    return undefined
  }

  return Number(params.value)
}

const toSshConfig = (params: { form: IDialogFormState }): IInstanceSshConfig => {
  return {
    host: params.form.host,
    identityFile: toOptionalStringValue({ value: params.form.identityFile }),
    port: toPortRequestValue({ value: params.form.port }),
    user: toOptionalStringValue({ value: params.form.user }),
  }
}

const toSubmitPromise = (params: {
  apiClient: ApiClient
  form: IDialogFormState
  instance: IInstance | null
}): Promise<IInstanceResponse> => {
  if (params.instance !== null) {
    return params.apiClient.updateInstance({
      id: params.instance.id,
      label: params.form.label,
      ssh: toSshConfig({ form: params.form }),
    })
  }

  return params.apiClient.createInstance({
    label: params.form.label,
    ssh: toSshConfig({ form: params.form }),
  })
}

const renderFieldError = (params: { message: string | null }): ReactElement | null => {
  if (params.message === null) {
    return null
  }

  return <div className="instance-dialog-field-error">{params.message}</div>
}

export const InstanceDialog = (props: IInstanceDialogProps): ReactElement => {
  const { instance, instances, onClose, onSaved } = props
  const isEditMode = instance !== null
  const instanceType = resolveInstanceType({ instance })
  const [form, setForm] = useState<IDialogFormState>(() => {
    return toInitialFormState({ instance })
  })
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isTestingConnection, setIsTestingConnection] = useState(false)
  const [testResult, setTestResult] = useState<ITestConnectionState | null>(null)

  const labelError = instanceLabelUtil.resolveLabelError({
    excludeId: instance?.id,
    instances,
    label: form.label,
    type: instanceType,
  })
  const hostError = resolveHostError({ type: instanceType, value: form.host })
  const portError = resolvePortError({ value: form.port })
  const hasValidationErrors = labelError !== null || hostError !== null || portError !== null

  const handleFormFieldChange = (params: { field: keyof IDialogFormState; value: string }): void => {
    setFormError(null)
    setTestResult(null)
    setForm((previous) => {
      return { ...previous, [params.field]: params.value }
    })
  }

  const handleTestConnection = (): void => {
    if (isTestingConnection) {
      return
    }

    setIsTestingConnection(true)

    void new ApiClient()
      .testConnection({ ssh: toSshConfig({ form }) })
      .then((response) => {
        setIsTestingConnection(false)
        setTestResult({ isError: false, message: response.message })
      })
      .catch((error: unknown) => {
        setIsTestingConnection(false)
        setTestResult({ isError: true, message: errorMessageUtil.toMessage({ error }) })
      })
  }

  const handleSubmit = (): void => {
    if (hasValidationErrors || isSubmitting) {
      return
    }

    setIsSubmitting(true)

    void toSubmitPromise({ apiClient: new ApiClient(), form, instance })
      .then((response) => {
        onSaved({ instance: response.instance })
      })
      .catch((error: unknown) => {
        setIsSubmitting(false)
        setFormError(errorMessageUtil.toMessage({ error }))
      })
  }

  const renderTestResult = (): ReactElement | null => {
    if (testResult === null) {
      return null
    }

    return <div className={resolveTestResultClassName({ isError: testResult.isError })}>{testResult.message}</div>
  }

  const renderTestConnectionRow = (): ReactElement => {
    const isTestDisabled = isTestingConnection || hostError !== null || portError !== null

    return (
      <div className="instance-dialog-test-row">
        <button className="instance-dialog-test" disabled={isTestDisabled} onClick={handleTestConnection} type="button">
          {resolveTestButtonLabel({ isTesting: isTestingConnection })}
        </button>
        {renderTestResult()}
      </div>
    )
  }

  const renderSshFields = (): ReactElement | null => {
    if (instanceType !== 'ssh') {
      return null
    }

    return (
      <>
        <label className="instance-dialog-field">
          <span className="instance-dialog-field-label">Host</span>
          <input
            className="instance-dialog-input"
            onChange={(event) => {
              handleFormFieldChange({ field: 'host', value: event.target.value })
            }}
            placeholder="host or ~/.ssh/config alias"
            value={form.host}
          />
          {renderFieldError({ message: hostError })}
        </label>
        <label className="instance-dialog-field">
          <span className="instance-dialog-field-label">User</span>
          <input
            className="instance-dialog-input"
            onChange={(event) => {
              handleFormFieldChange({ field: 'user', value: event.target.value })
            }}
            placeholder="optional"
            value={form.user}
          />
        </label>
        <label className="instance-dialog-field">
          <span className="instance-dialog-field-label">Port</span>
          <input
            className="instance-dialog-input"
            onChange={(event) => {
              handleFormFieldChange({ field: 'port', value: event.target.value })
            }}
            placeholder="22"
            type="number"
            value={form.port}
          />
          {renderFieldError({ message: portError })}
        </label>
        <label className="instance-dialog-field">
          <span className="instance-dialog-field-label">Identity file</span>
          <input
            className="instance-dialog-input"
            onChange={(event) => {
              handleFormFieldChange({ field: 'identityFile', value: event.target.value })
            }}
            placeholder="~/.ssh/id_ed25519"
            value={form.identityFile}
          />
        </label>
        {renderTestConnectionRow()}
      </>
    )
  }

  const renderFormError = (): ReactElement | null => {
    if (formError === null) {
      return null
    }

    return <div className="instance-dialog-form-error">{formError}</div>
  }

  return (
    <div className="instance-dialog-overlay">
      <div className="instance-dialog">
        <div className="instance-dialog-title">{resolveDialogTitle({ isEditMode })}</div>
        <label className="instance-dialog-field">
          <span className="instance-dialog-field-label">Label</span>
          <input
            className="instance-dialog-input"
            onChange={(event) => {
              handleFormFieldChange({ field: 'label', value: event.target.value })
            }}
            placeholder="e.g. Work server"
            value={form.label}
          />
          {renderFieldError({ message: labelError })}
        </label>
        {renderSshFields()}
        {renderFormError()}
        <div className="instance-dialog-actions">
          <button className="instance-dialog-cancel" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="instance-dialog-submit"
            disabled={hasValidationErrors || isSubmitting}
            onClick={handleSubmit}
            type="button"
          >
            {resolveSaveButtonLabel({ isEditMode })}
          </button>
        </div>
      </div>
    </div>
  )
}
