import { type ReactElement, type KeyboardEvent as ReactKeyboardEvent, useState } from 'react'

import { ApiClient } from '#src/renderer/src/business/service/api-client'
import { errorMessageUtil } from '#src/renderer/src/util/error-message-util'
import { sessionNamingUtil } from '#src/shared/session-naming-util'

import '#src/renderer/src/ui-component/clone-session-dialog/clone-session-dialog.css'

interface ICloneSessionDialogProps {
  instanceId: string
  onClose: () => void
  onCloned: (params: { instanceId: string; name: string }) => void
  sourceName: string
  suggestedName: string
}

const resolveNameError = (params: { value: string }): string | null => {
  return sessionNamingUtil.validateSessionName(params.value)
}

const renderFieldError = (params: { message: string | null }): ReactElement | null => {
  if (params.message === null) {
    return null
  }

  return <div className="clone-session-dialog-field-error">{params.message}</div>
}

export const CloneSessionDialog = (props: ICloneSessionDialogProps): ReactElement => {
  const { instanceId, onClose, onCloned, sourceName, suggestedName } = props
  const [name, setName] = useState(suggestedName)
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const nameError = resolveNameError({ value: name })

  const handleNameChange = (params: { value: string }): void => {
    setFormError(null)
    setName(params.value)
  }

  const handleSubmit = (): void => {
    if (nameError !== null || isSubmitting) {
      return
    }

    setIsSubmitting(true)

    void new ApiClient()
      .cloneSession({ instanceId, name, sourceName })
      .then((response) => {
        onCloned({ instanceId, name: response.name })
      })
      .catch((error: unknown) => {
        setIsSubmitting(false)
        setFormError(errorMessageUtil.toMessage({ error }))
      })
  }

  const handleNameKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    switch (event.key) {
      case 'Enter': {
        handleSubmit()
        break
      }

      case 'Escape': {
        onClose()
        break
      }

      default: {
        break
      }
    }
  }

  const renderFormError = (): ReactElement | null => {
    if (formError === null) {
      return null
    }

    return <div className="clone-session-dialog-form-error">{formError}</div>
  }

  return (
    <div className="clone-session-dialog-overlay">
      <div className="clone-session-dialog">
        <div className="clone-session-dialog-title">Clone session</div>
        <label className="clone-session-dialog-field">
          <span className="clone-session-dialog-field-label">Name</span>
          <input
            autoFocus
            className="clone-session-dialog-input"
            onChange={(event) => {
              handleNameChange({ value: event.target.value })
            }}
            onKeyDown={handleNameKeyDown}
            value={name}
          />
          {renderFieldError({ message: nameError })}
        </label>
        {renderFormError()}
        <div className="clone-session-dialog-actions">
          <button className="clone-session-dialog-cancel" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="clone-session-dialog-submit"
            disabled={nameError !== null || isSubmitting}
            onClick={handleSubmit}
            type="button"
          >
            Clone
          </button>
        </div>
      </div>
    </div>
  )
}
