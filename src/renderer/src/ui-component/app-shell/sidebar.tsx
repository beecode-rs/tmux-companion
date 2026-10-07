import {
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from 'react'

import { ApiClient } from '#src/renderer/src/business/service/api-client'
import { type ISessionsSnapshot, useInstances } from '#src/renderer/src/business/service/instances-store'
import { CloneSessionDialog } from '#src/renderer/src/ui-component/clone-session-dialog/clone-session-dialog'
import { Icon } from '#src/renderer/src/ui-component/icon/icon'
import { errorMessageUtil } from '#src/renderer/src/util/error-message-util'
import { type IInstance, type InstanceType } from '#src/shared/instance-model'
import { type ISessionInfo } from '#src/shared/session-model'
import { sessionNamingUtil } from '#src/shared/session-naming-util'
import { type TerminalMode } from '#src/shared/terminal-mode-model'

interface ISidebarProps {
  onEditInstance: (instance: IInstance) => void
}

interface ISessionCloneState {
  instanceId: string
  sourceName: string
  suggestedName: string
}

interface ISessionCreateState {
  instanceId: string
  value: string
}

interface ISessionRenameState {
  instanceId: string
  name: string
  value: string
}

interface ISidebarMenuState {
  instanceId: string
  leftPx: number
  sessionName: string | null
  topPx: number
}

const resolveAttachedDotClassName = (params: { isAttached: boolean }): string => {
  if (params.isAttached) {
    return 'sidebar-attached-dot is-attached'
  }

  return 'sidebar-attached-dot'
}

const resolveChevron = (params: { isCollapsed: boolean }): string => {
  if (params.isCollapsed) {
    return '▸'
  }

  return '▾'
}

const resolveChevronTitle = (params: { isCollapsed: boolean }): string => {
  if (params.isCollapsed) {
    return 'Expand'
  }

  return 'Collapse'
}

const resolveInstanceGroupClassName = (params: { isSelected: boolean }): string => {
  if (params.isSelected) {
    return 'sidebar-instance is-selected'
  }

  return 'sidebar-instance'
}

const resolveInstanceIcon = (params: { type: InstanceType }): ReactElement => {
  if (params.type === 'ssh') {
    return <Icon name="servers" />
  }

  return <Icon name="monitor" />
}

const resolveInstanceIconClassName = (params: { isConnected: boolean; type: InstanceType }): string => {
  if (params.type === 'ssh') {
    if (params.isConnected) {
      return 'sidebar-instance-icon is-ssh'
    }

    return 'sidebar-instance-icon is-ssh is-disconnected'
  }

  return 'sidebar-instance-icon is-local'
}

const resolveInstanceIconTitle = (params: { isConnected: boolean; type: InstanceType }): string => {
  if (params.type === 'ssh') {
    if (params.isConnected) {
      return 'SSH instance'
    }

    return 'SSH instance (not connected)'
  }

  return 'Local instance'
}

const resolveMenuItemClassName = (params: { isDanger: boolean }): string => {
  if (params.isDanger) {
    return 'sidebar-menu-item is-danger'
  }

  return 'sidebar-menu-item'
}

const INSTANCE_BASE_MENU_ITEM_COUNT = 2

const MENU_CHROME_HEIGHT_PX = 10

const MENU_ITEM_HEIGHT_PX = 32

const MENU_SEPARATOR_HEIGHT_PX = 9

const SESSION_MENU_ITEM_COUNT = 3

const SESSION_MENU_SEPARATOR_COUNT = 1

const SSH_INSTANCE_MENU_SEPARATOR_COUNT = 2

const SSH_MENU_ITEM_COUNT = 2

const resolveConnectionMenuItemCount = (params: { isConnected: boolean }): number => {
  if (params.isConnected) {
    return 2
  }

  return 1
}

const resolveMenuHeightFromItemCount = (params: { itemCount: number; separatorCount?: number }): number => {
  const separatorCount = params.separatorCount ?? 0

  return params.itemCount * MENU_ITEM_HEIGHT_PX + separatorCount * MENU_SEPARATOR_HEIGHT_PX + MENU_CHROME_HEIGHT_PX
}

const resolveInstanceMenuHeightPx = (params: { instance: IInstance; isConnected: boolean }): number => {
  if (params.instance.type !== 'ssh') {
    return resolveMenuHeightFromItemCount({ itemCount: INSTANCE_BASE_MENU_ITEM_COUNT })
  }

  return resolveMenuHeightFromItemCount({
    itemCount:
      INSTANCE_BASE_MENU_ITEM_COUNT +
      resolveConnectionMenuItemCount({ isConnected: params.isConnected }) +
      SSH_MENU_ITEM_COUNT,
    separatorCount: SSH_INSTANCE_MENU_SEPARATOR_COUNT,
  })
}

const resolveMenuHeightPx = (params: {
  instance: IInstance | undefined
  isConnected: boolean
  sessionName: string | null
}): number => {
  if (params.sessionName !== null) {
    return resolveMenuHeightFromItemCount({
      itemCount: SESSION_MENU_ITEM_COUNT,
      separatorCount: SESSION_MENU_SEPARATOR_COUNT,
    })
  }

  if (params.instance === undefined) {
    return resolveMenuHeightFromItemCount({ itemCount: INSTANCE_BASE_MENU_ITEM_COUNT })
  }

  return resolveInstanceMenuHeightPx({ instance: params.instance, isConnected: params.isConnected })
}

type SidebarMenuIconVariant = 'add' | 'default' | 'edit' | 'power' | 'refresh' | 'reload'

const resolveMenuItemIconClassName = (params: { variant: SidebarMenuIconVariant }): string => {
  return `sidebar-menu-item-icon is-${params.variant}`
}

const renderMenuItem = (params: {
  icon: ReactNode
  iconVariant?: SidebarMenuIconVariant
  isDanger?: boolean
  label: string
  onClick: () => void
}): ReactElement => {
  const isDanger = params.isDanger === true
  const iconVariant = params.iconVariant ?? 'default'

  return (
    <button
      className={resolveMenuItemClassName({ isDanger })}
      onClick={() => {
        params.onClick()
      }}
      type="button"
    >
      <span className={resolveMenuItemIconClassName({ variant: iconVariant })}>{params.icon}</span>
      <span className="sidebar-menu-item-label">{params.label}</span>
    </button>
  )
}

const renderMenuSeparator = (): ReactElement => {
  return <div className="sidebar-menu-separator" />
}

const resolveRemoveConfirmMessage = (params: { label: string; sessionCount: number }): string => {
  if (params.sessionCount > 0) {
    return `Remove instance '${params.label}' and kill its ${String(params.sessionCount)} tmux session(s)?`
  }

  return `Remove instance '${params.label}'?`
}

const resolveCreateError = (params: { value: string }): string | null => {
  if (params.value === '') {
    return null
  }

  return sessionNamingUtil.validateSessionName(params.value)
}

const resolveRenameError = (params: { renameState: ISessionRenameState; sessions: ISessionInfo[] }): string | null => {
  const validationError = sessionNamingUtil.validateSessionName(params.renameState.value)

  if (validationError !== null) {
    return validationError
  }

  const isDuplicate = params.sessions.some((session) => {
    return session.name === params.renameState.value && session.name !== params.renameState.name
  })

  if (isDuplicate) {
    return `Session name '${params.renameState.value}' is already in use`
  }

  return null
}

const isInstanceHeaderActive = (params: {
  instanceId: string
  mode: TerminalMode
  selectedInstanceId: string | null
}): boolean => {
  if (params.mode !== 'machine') {
    return false
  }

  return params.selectedInstanceId === params.instanceId
}

const isSessionRowActive = (params: {
  instanceId: string
  mode: TerminalMode
  selectedInstanceId: string | null
  session: ISessionInfo
}): boolean => {
  if (params.mode !== 'tmux') {
    return false
  }

  if (params.selectedInstanceId !== params.instanceId) {
    return false
  }

  return params.session.active
}

const resolveSessionRowClassName = (params: { isActive: boolean }): string => {
  if (params.isActive) {
    return 'sidebar-session-row is-active'
  }

  return 'sidebar-session-row'
}

const toCreateSessionRequest = (params: {
  instanceId: string
  value: string
}): { instanceId: string; name?: string } => {
  if (params.value === '') {
    return { instanceId: params.instanceId }
  }

  return { instanceId: params.instanceId, name: params.value }
}

const toEmptySnapshot = (): ISessionsSnapshot => {
  return { events: 'poll', sessions: [] }
}

const renderInlineError = (params: { message: string | null }): ReactElement | null => {
  if (params.message === null) {
    return null
  }

  return <div className="sidebar-input-error">{params.message}</div>
}

export const Sidebar = (props: ISidebarProps): ReactElement => {
  const { onEditInstance } = props
  const {
    connectedInstanceIds,
    connectInstance,
    disconnectInstance,
    instances,
    refresh,
    refreshInstances,
    reloadInstance,
    selectInstance,
    selectInstanceMachine,
    selectedInstanceId,
    setExpandedInstanceIds,
    settings,
    snapshotsByInstanceId,
    terminalMode,
  } = useInstances()
  const [actionError, setActionError] = useState<string | null>(null)
  const [cloneState, setCloneState] = useState<ISessionCloneState | null>(null)
  const [createState, setCreateState] = useState<ISessionCreateState | null>(null)
  const [isCollapsedByInstanceId, setIsCollapsedByInstanceId] = useState<Record<string, boolean>>({})
  const [menuState, setMenuState] = useState<ISidebarMenuState | null>(null)
  const [renameState, setRenameState] = useState<ISessionRenameState | null>(null)

  const confirmBeforeKill = settings?.confirmBeforeKill === true

  useEffect(() => {
    setExpandedInstanceIds(
      instances
        .filter((instance) => {
          return isCollapsedByInstanceId[instance.id] !== true
        })
        .map((instance) => {
          return instance.id
        }),
    )
  }, [instances, isCollapsedByInstanceId, setExpandedInstanceIds])

  const runAction = useCallback(
    async (params: { action: () => Promise<void>; instanceId: string }): Promise<void> => {
      setActionError(null)

      try {
        await params.action()
      } catch (error) {
        setActionError(errorMessageUtil.toMessage({ error }))
      }

      await refresh({ instanceId: params.instanceId })
    },
    [refresh],
  )

  const handleToggleCollapse = (instanceId: string): void => {
    setIsCollapsedByInstanceId((previous) => {
      return { ...previous, [instanceId]: !(previous[instanceId] === true) }
    })
  }

  const handleRefreshSessions = (params: { instanceId: string }): void => {
    void refresh({ instanceId: params.instanceId })
  }

  const handleOpenMenu = (params: {
    event: ReactMouseEvent<HTMLButtonElement>
    instanceId: string
    sessionName: string | null
  }): void => {
    const instance = instances.find((candidate) => {
      return candidate.id === params.instanceId
    })
    const rect = params.event.currentTarget.getBoundingClientRect()
    const menuHeightPx = resolveMenuHeightPx({
      instance,
      isConnected: connectedInstanceIds.includes(params.instanceId),
      sessionName: params.sessionName,
    })
    const maxTopPx = window.innerHeight - menuHeightPx - 8

    setMenuState({
      instanceId: params.instanceId,
      leftPx: rect.right,
      sessionName: params.sessionName,
      topPx: Math.min(rect.bottom + 2, Math.max(maxTopPx, 0)),
    })
  }

  const runMenuAction = (params: { action: () => void }): void => {
    setMenuState(null)
    params.action()
  }

  useEffect(() => {
    if (menuState === null) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setMenuState(null)
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuState])

  const handleSwitchSession = (params: { instanceId: string; name: string }): void => {
    void runAction({
      action: async () => {
        await new ApiClient().switchSession({ instanceId: params.instanceId, name: params.name })
        selectInstance(params.instanceId)
      },
      instanceId: params.instanceId,
    })
  }

  const handleKillSession = (params: { instanceId: string; name: string }): void => {
    if (confirmBeforeKill) {
      const isConfirmed = window.confirm(`Kill session '${params.name}'?`)

      if (!isConfirmed) {
        return
      }
    }

    void runAction({
      action: async () => {
        await new ApiClient().deleteSession({ instanceId: params.instanceId, name: params.name })
      },
      instanceId: params.instanceId,
    })
  }

  const handleRemoveInstance = (params: { instance: IInstance }): void => {
    const sessionCount = snapshotsByInstanceId[params.instance.id]?.sessions.length ?? 0

    if (!window.confirm(resolveRemoveConfirmMessage({ label: params.instance.label, sessionCount }))) {
      return
    }

    void runAction({
      action: async () => {
        await new ApiClient().deleteInstance({ id: params.instance.id, killSessions: true })
        await refreshInstances()
      },
      instanceId: params.instance.id,
    })
  }

  const handleConnectInstance = (params: { instance: IInstance }): void => {
    connectInstance({ instanceId: params.instance.id })
  }

  const handleDisconnectInstance = (params: { instance: IInstance }): void => {
    void runAction({
      action: async () => {
        await disconnectInstance({ instanceId: params.instance.id })
      },
      instanceId: params.instance.id,
    })
  }

  const handleReloadInstance = (params: { instance: IInstance }): void => {
    void runAction({
      action: async () => {
        await reloadInstance({ instanceId: params.instance.id })
      },
      instanceId: params.instance.id,
    })
  }

  const handleOpenCreate = (params: { instance: IInstance }): void => {
    const snapshot = snapshotsByInstanceId[params.instance.id]
    const names = (snapshot?.sessions ?? []).map((session) => {
      return session.name
    })

    setCreateState({
      instanceId: params.instance.id,
      value: sessionNamingUtil.toNextSessionName({ names }),
    })
  }

  const handleOpenClone = (params: { instanceId: string; session: ISessionInfo }): void => {
    const snapshot = snapshotsByInstanceId[params.instanceId]
    const names = (snapshot?.sessions ?? []).map((session) => {
      return session.name
    })

    setCloneState({
      instanceId: params.instanceId,
      sourceName: params.session.name,
      suggestedName: sessionNamingUtil.toCloneSessionName({ names, sourceName: params.session.name }),
    })
  }

  const handleSessionCloned = (params: { instanceId: string; name: string }): void => {
    setCloneState(null)
    handleSwitchSession({ instanceId: params.instanceId, name: params.name })
  }

  const handleOpenRename = (params: { instanceId: string; session: ISessionInfo }): void => {
    setRenameState({
      instanceId: params.instanceId,
      name: params.session.name,
      value: params.session.name,
    })
  }

  const handleRenameChange = (params: { value: string }): void => {
    setRenameState((previous) => {
      if (previous === null) {
        return null
      }

      return { ...previous, value: params.value }
    })
  }

  const handleCreateChange = (params: { value: string }): void => {
    setCreateState((previous) => {
      if (previous === null) {
        return null
      }

      return { ...previous, value: params.value }
    })
  }

  const handleRenameSubmit = (): void => {
    if (renameState === null) {
      return
    }

    const sessions = snapshotsByInstanceId[renameState.instanceId]?.sessions ?? []
    const renameError = resolveRenameError({ renameState, sessions })

    if (renameError !== null) {
      return
    }

    const { instanceId, name, value } = renameState

    setRenameState(null)
    void runAction({
      action: async () => {
        await new ApiClient().renameSession({ currentName: name, instanceId, nextName: value })
      },
      instanceId,
    })
  }

  const handleCreateSubmit = (): void => {
    if (createState === null) {
      return
    }

    const createError = resolveCreateError({ value: createState.value })

    if (createError !== null) {
      return
    }

    const request = toCreateSessionRequest({ instanceId: createState.instanceId, value: createState.value })

    setCreateState(null)
    void runAction({
      action: async () => {
        await new ApiClient().createSession(request)
      },
      instanceId: request.instanceId,
    })
  }

  const handleRenameKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    switch (event.key) {
      case 'Enter': {
        handleRenameSubmit()
        break
      }

      case 'Escape': {
        setRenameState(null)
        break
      }

      default: {
        break
      }
    }
  }

  const handleCreateKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    switch (event.key) {
      case 'Enter': {
        handleCreateSubmit()
        break
      }

      case 'Escape': {
        setCreateState(null)
        break
      }

      default: {
        break
      }
    }
  }

  const renderActionError = (): ReactElement | null => {
    if (actionError === null) {
      return null
    }

    return <div className="sidebar-error">{actionError}</div>
  }

  const renderSessionRow = (params: { instance: IInstance; session: ISessionInfo }): ReactElement => {
    const isRenaming =
      renameState !== null && renameState.instanceId === params.instance.id && renameState.name === params.session.name

    if (isRenaming) {
      const sessions = snapshotsByInstanceId[params.instance.id]?.sessions ?? []
      const renameError = resolveRenameError({ renameState, sessions })

      return (
        <div className="sidebar-edit" key={params.session.name}>
          <input
            autoFocus
            className="sidebar-input"
            onBlur={() => {
              setRenameState(null)
            }}
            onChange={(event) => {
              handleRenameChange({ value: event.target.value })
            }}
            onKeyDown={handleRenameKeyDown}
            value={renameState.value}
          />
          {renderInlineError({ message: renameError })}
        </div>
      )
    }

    return (
      <div
        className={resolveSessionRowClassName({
          isActive: isSessionRowActive({
            instanceId: params.instance.id,
            mode: terminalMode,
            selectedInstanceId,
            session: params.session,
          }),
        })}
        key={params.session.name}
      >
        <button
          className="sidebar-session-main"
          onClick={() => {
            handleSwitchSession({ instanceId: params.instance.id, name: params.session.name })
          }}
          onDoubleClick={() => {
            handleOpenRename({ instanceId: params.instance.id, session: params.session })
          }}
          type="button"
        >
          <span className={resolveAttachedDotClassName({ isAttached: params.session.attached })} />
          <span className="sidebar-session-name">{params.session.name}</span>
        </button>
        <button
          className="sidebar-session-kebab"
          onClick={(event) => {
            handleOpenMenu({ event, instanceId: params.instance.id, sessionName: params.session.name })
          }}
          title="Session actions"
          type="button"
        >
          ⋯
        </button>
      </div>
    )
  }

  const renderCreateInput = (params: { instance: IInstance }): ReactElement | null => {
    if (createState?.instanceId !== params.instance.id) {
      return null
    }

    const createError = resolveCreateError({ value: createState.value })

    return (
      <div className="sidebar-edit">
        <input
          autoFocus
          className="sidebar-input"
          onBlur={() => {
            setCreateState(null)
          }}
          onChange={(event) => {
            handleCreateChange({ value: event.target.value })
          }}
          onKeyDown={handleCreateKeyDown}
          value={createState.value}
        />
        {renderInlineError({ message: createError })}
      </div>
    )
  }

  const renderInstanceGroup = (params: { instance: IInstance }): ReactElement => {
    const isCollapsed = isCollapsedByInstanceId[params.instance.id] === true
    const isConnected = connectedInstanceIds.includes(params.instance.id)
    const snapshot = snapshotsByInstanceId[params.instance.id] ?? toEmptySnapshot()

    return (
      <div
        className={resolveInstanceGroupClassName({
          isSelected: isInstanceHeaderActive({
            instanceId: params.instance.id,
            mode: terminalMode,
            selectedInstanceId,
          }),
        })}
        key={params.instance.id}
      >
        <div className="sidebar-instance-header">
          <button
            className="sidebar-instance-chevron-button"
            onClick={() => {
              handleToggleCollapse(params.instance.id)
            }}
            title={resolveChevronTitle({ isCollapsed })}
            type="button"
          >
            <span className="sidebar-instance-chevron">{resolveChevron({ isCollapsed })}</span>
          </button>
          <button
            className="sidebar-instance-button"
            onClick={() => {
              selectInstanceMachine(params.instance.id)
            }}
            type="button"
          >
            <span
              className={resolveInstanceIconClassName({ isConnected, type: params.instance.type })}
              title={resolveInstanceIconTitle({ isConnected, type: params.instance.type })}
            >
              {resolveInstanceIcon({ type: params.instance.type })}
            </span>
            <span className="sidebar-instance-label">{params.instance.label}</span>
          </button>
          <button
            className="sidebar-instance-kebab"
            onClick={(event) => {
              handleOpenMenu({ event, instanceId: params.instance.id, sessionName: null })
            }}
            title="Instance actions"
            type="button"
          >
            ⋯
          </button>
        </div>
        {renderInstanceBody({ instance: params.instance, isCollapsed, snapshot })}
      </div>
    )
  }

  const renderMenuOverlay = (): ReactElement | null => {
    if (menuState === null) {
      return null
    }

    return (
      <div
        className="sidebar-menu-overlay"
        onClick={() => {
          setMenuState(null)
        }}
      />
    )
  }

  const renderInstanceMenuItems = (params: { instance: IInstance }): ReactElement => {
    return (
      <>
        {renderConnectionMenuItems({ instance: params.instance })}
        {renderMenuItem({
          icon: <Icon name="plus" />,
          iconVariant: 'add',
          label: 'New session',
          onClick: () => {
            runMenuAction({
              action: () => {
                handleOpenCreate({ instance: params.instance })
              },
            })
          },
        })}
        {renderMenuItem({
          icon: <Icon name="refresh" />,
          iconVariant: 'refresh',
          label: 'Refresh sessions',
          onClick: () => {
            runMenuAction({
              action: () => {
                handleRefreshSessions({ instanceId: params.instance.id })
              },
            })
          },
        })}
        {renderSshInstanceMenuItems({ instance: params.instance })}
      </>
    )
  }

  const renderConnectionMenuItems = (params: { instance: IInstance }): ReactElement | null => {
    if (params.instance.type !== 'ssh') {
      return null
    }

    const isConnected = connectedInstanceIds.includes(params.instance.id)

    if (!isConnected) {
      return (
        <>
          {renderMenuItem({
            icon: <Icon name="power" />,
            iconVariant: 'power',
            label: 'Connect',
            onClick: () => {
              runMenuAction({
                action: () => {
                  handleConnectInstance({ instance: params.instance })
                },
              })
            },
          })}
          {renderMenuSeparator()}
        </>
      )
    }

    return (
      <>
        {renderMenuItem({
          icon: <Icon name="power" />,
          iconVariant: 'power',
          label: 'Disconnect',
          onClick: () => {
            runMenuAction({
              action: () => {
                handleDisconnectInstance({ instance: params.instance })
              },
            })
          },
        })}
        {renderMenuItem({
          icon: <Icon name="rotate" />,
          iconVariant: 'reload',
          label: 'Reload',
          onClick: () => {
            runMenuAction({
              action: () => {
                handleReloadInstance({ instance: params.instance })
              },
            })
          },
        })}
        {renderMenuSeparator()}
      </>
    )
  }

  const renderSshInstanceMenuItems = (params: { instance: IInstance }): ReactElement | null => {
    if (params.instance.type !== 'ssh') {
      return null
    }

    return (
      <>
        {renderMenuSeparator()}
        {renderMenuItem({
          icon: <Icon name="pencil" />,
          iconVariant: 'edit',
          label: 'Edit instance',
          onClick: () => {
            runMenuAction({
              action: () => {
                onEditInstance(params.instance)
              },
            })
          },
        })}
        {renderMenuItem({
          icon: <Icon name="x" />,
          isDanger: true,
          label: 'Remove instance',
          onClick: () => {
            runMenuAction({
              action: () => {
                handleRemoveInstance({ instance: params.instance })
              },
            })
          },
        })}
      </>
    )
  }

  const renderSessionMenuItems = (params: { instanceId: string; session: ISessionInfo }): ReactElement => {
    return (
      <>
        {renderMenuItem({
          icon: <Icon name="pencil" />,
          iconVariant: 'edit',
          label: 'Rename session',
          onClick: () => {
            runMenuAction({
              action: () => {
                handleOpenRename({ instanceId: params.instanceId, session: params.session })
              },
            })
          },
        })}
        {renderMenuItem({
          icon: <Icon name="copy" />,
          iconVariant: 'default',
          label: 'Clone session',
          onClick: () => {
            runMenuAction({
              action: () => {
                handleOpenClone({ instanceId: params.instanceId, session: params.session })
              },
            })
          },
        })}
        {renderMenuSeparator()}
        {renderMenuItem({
          icon: <Icon name="trash" />,
          isDanger: true,
          label: 'Kill session',
          onClick: () => {
            runMenuAction({
              action: () => {
                handleKillSession({ instanceId: params.instanceId, name: params.session.name })
              },
            })
          },
        })}
      </>
    )
  }

  const renderMenu = (): ReactElement | null => {
    if (menuState === null) {
      return null
    }

    const instance = instances.find((candidate) => {
      return candidate.id === menuState.instanceId
    })

    if (instance === undefined) {
      return null
    }

    const menuStyle = { left: `${String(menuState.leftPx)}px`, top: `${String(menuState.topPx)}px` }

    if (menuState.sessionName === null) {
      return (
        <div className="sidebar-menu" style={menuStyle}>
          {renderInstanceMenuItems({ instance })}
        </div>
      )
    }

    const session =
      snapshotsByInstanceId[menuState.instanceId]?.sessions.find((candidate) => {
        return candidate.name === menuState.sessionName
      }) ?? null

    if (session === null) {
      return null
    }

    return (
      <div className="sidebar-menu" style={menuStyle}>
        {renderSessionMenuItems({ instanceId: menuState.instanceId, session })}
      </div>
    )
  }

  const renderCloneDialog = (): ReactElement | null => {
    if (cloneState === null) {
      return null
    }

    return (
      <CloneSessionDialog
        instanceId={cloneState.instanceId}
        onClose={() => {
          setCloneState(null)
        }}
        onCloned={handleSessionCloned}
        sourceName={cloneState.sourceName}
        suggestedName={cloneState.suggestedName}
      />
    )
  }

  const renderInstanceBody = (params: {
    instance: IInstance
    isCollapsed: boolean
    snapshot: ISessionsSnapshot
  }): ReactElement | null => {
    if (params.isCollapsed) {
      return null
    }

    return (
      <div className="sidebar-instance-body">
        {renderCreateInput({ instance: params.instance })}
        {params.snapshot.sessions.map((session) => {
          return renderSessionRow({ instance: params.instance, session })
        })}
      </div>
    )
  }

  return (
    <div className="sidebar">
      {instances.map((instance) => {
        return renderInstanceGroup({ instance })
      })}
      {renderActionError()}
      {renderMenuOverlay()}
      {renderMenu()}
      {renderCloneDialog()}
    </div>
  )
}
