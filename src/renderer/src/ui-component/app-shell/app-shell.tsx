import { type ReactElement, useState } from 'react'

import { type ISessionsSnapshot, useInstances } from '#src/renderer/src/business/service/instances-store'
import { AboutPage } from '#src/renderer/src/ui-component/about/about-page'
import '#src/renderer/src/ui-component/app-shell/app-shell.css'
import { Sidebar } from '#src/renderer/src/ui-component/app-shell/sidebar'
import { TopBar } from '#src/renderer/src/ui-component/app-shell/top-bar'
import { Icon } from '#src/renderer/src/ui-component/icon/icon'
import { InstanceDialog } from '#src/renderer/src/ui-component/instance-dialog/instance-dialog'
import { SettingsPage } from '#src/renderer/src/ui-component/settings-page/settings-page'
import { TerminalView } from '#src/renderer/src/ui-component/terminal-view/terminal-view'
import { type IInstance } from '#src/shared/instance-model'
import { type TerminalMode } from '#src/shared/terminal-mode-model'

type AppViewId = 'terminal' | 'settings' | 'about'

const PRIMARY_VIEW_IDS: AppViewId[] = ['terminal']

const MENU_VIEW_IDS: AppViewId[] = ['settings', 'about']

const VIEW_LABELS: Record<AppViewId, string> = {
  about: 'About',
  settings: 'Settings',
  terminal: 'Terminal',
}

const resolveSelectedSnapshot = (params: {
  instanceId: string | null
  snapshotsByInstanceId: Record<string, ISessionsSnapshot>
}): ISessionsSnapshot | undefined => {
  if (params.instanceId === null) {
    return undefined
  }

  return params.snapshotsByInstanceId[params.instanceId]
}

const resolveActiveSessionName = (params: { snapshot: ISessionsSnapshot | undefined }): string | null => {
  const sessions = params.snapshot?.sessions ?? []
  const activeSession =
    sessions.find((session) => {
      return session.active
    }) ??
    sessions[0] ??
    null

  if (activeSession === null) {
    return null
  }

  return activeSession.name
}

const resolveSessionSnapshotForMode = (params: {
  mode: TerminalMode
  snapshot: ISessionsSnapshot | undefined
}): ISessionsSnapshot | undefined => {
  if (params.mode === 'machine') {
    return undefined
  }

  return params.snapshot
}

const resolveViewButtonClassName = (params: { isActive: boolean }): string => {
  if (params.isActive) {
    return 'app-shell-view-button is-active'
  }

  return 'app-shell-view-button'
}

const resolveTerminalPaneClassName = (params: { isActive: boolean }): string => {
  if (params.isActive) {
    return 'app-shell-terminal-pane'
  }

  return 'app-shell-terminal-pane is-hidden'
}

const resolveSidebarClassName = (params: { isVisible: boolean }): string => {
  if (params.isVisible) {
    return 'app-shell-sidebar'
  }

  return 'app-shell-sidebar is-hidden'
}

const resolveSidebarToggleTitle = (params: { isOpen: boolean }): string => {
  if (params.isOpen) {
    return 'Hide sidebar'
  }

  return 'Show sidebar'
}

export const AppShell = (): ReactElement => {
  const [activeViewId, setActiveViewId] = useState<AppViewId>('terminal')
  const [editingInstance, setEditingInstance] = useState<IInstance | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const {
    instances,
    refreshInstances,
    selectInstance,
    selectedInstanceId,
    snapshotsByInstanceId,
    terminalEpoch,
    terminalMode,
  } = useInstances()

  const isTerminalView = activeViewId === 'terminal'
  const isSidebarVisible = isTerminalView && isSidebarOpen

  const selectedSnapshot = resolveSelectedSnapshot({ instanceId: selectedInstanceId, snapshotsByInstanceId })
  const activeSessionName = resolveActiveSessionName({
    snapshot: resolveSessionSnapshotForMode({ mode: terminalMode, snapshot: selectedSnapshot }),
  })

  const handleSelectInstance = (nextInstanceId: string): void => {
    selectInstance(nextInstanceId)
    setActiveViewId('terminal')
  }

  const handleToggleSidebar = (): void => {
    setIsSidebarOpen((previous) => {
      return !previous
    })
  }

  const handleOpenCreateDialog = (): void => {
    setEditingInstance(null)
    setIsDialogOpen(true)
  }

  const handleOpenEditDialog = (instance: IInstance): void => {
    setEditingInstance(instance)
    setIsDialogOpen(true)
  }

  const handleDialogClose = (): void => {
    setIsDialogOpen(false)
  }

  const handleDialogSaved = (params: { instance: IInstance }): void => {
    setIsDialogOpen(false)
    handleSelectInstance(params.instance.id)
    void refreshInstances()
  }

  const renderViewNav = (params: { viewIds: AppViewId[] }): ReactElement => {
    const { viewIds } = params

    return (
      <nav className="app-shell-view-nav">
        {viewIds.map((viewId) => {
          return (
            <button
              className={resolveViewButtonClassName({ isActive: viewId === activeViewId })}
              key={viewId}
              onClick={() => {
                setActiveViewId(viewId)
              }}
              type="button"
            >
              {VIEW_LABELS[viewId]}
            </button>
          )
        })}
      </nav>
    )
  }

  const renderSidebarToggle = (): ReactElement | null => {
    if (!isTerminalView) {
      return null
    }

    return (
      <button
        className="app-shell-sidebar-toggle"
        onClick={handleToggleSidebar}
        title={resolveSidebarToggleTitle({ isOpen: isSidebarOpen })}
        type="button"
      >
        <Icon name="menu" />
      </button>
    )
  }

  const renderDialog = (): ReactElement | null => {
    if (!isDialogOpen) {
      return null
    }

    return (
      <InstanceDialog
        instance={editingInstance}
        instances={instances}
        onClose={handleDialogClose}
        onSaved={handleDialogSaved}
      />
    )
  }

  const renderSecondaryView = (): ReactElement | null => {
    switch (activeViewId) {
      case 'about': {
        return <AboutPage />
      }

      case 'settings': {
        return (
          <SettingsPage
            onOpenAbout={() => {
              setActiveViewId('about')
            }}
          />
        )
      }

      case 'terminal': {
        return null
      }

      default: {
        throw new Error(`unsupported view: ${String(activeViewId)}`)
      }
    }
  }

  return (
    <div className="app-shell">
      <header className="app-shell-top-bar">
        {renderSidebarToggle()}
        {renderViewNav({ viewIds: PRIMARY_VIEW_IDS })}
        <TopBar instanceId={selectedInstanceId} sessionName={activeSessionName} />
        <div className="app-shell-top-bar-separator" />
        {renderViewNav({ viewIds: MENU_VIEW_IDS })}
      </header>
      <div className="app-shell-body">
        <aside className={resolveSidebarClassName({ isVisible: isSidebarVisible })}>
          <Sidebar onAddRemoteInstance={handleOpenCreateDialog} onEditInstance={handleOpenEditDialog} />
        </aside>
        <main className="app-shell-content">
          <div className={resolveTerminalPaneClassName({ isActive: isTerminalView })}>
            <TerminalView attachEpoch={terminalEpoch} instanceId={selectedInstanceId} mode={terminalMode} />
          </div>
          {renderSecondaryView()}
          {renderDialog()}
        </main>
      </div>
    </div>
  )
}
