import { useState } from 'react'
import { Check, Copy, FolderOpen, MoreHorizontal, PenLine, Plus, Sparkles, Trash2 } from 'lucide-react'
import { Dialog, DialogContent } from '../../../ui/dialog'
import { Button } from '../../../ui/button'
import { Input } from '../../../ui/input'
import {
  Dropdown,
  DropdownTrigger,
  DropdownContent,
  MenuItem,
  MenuSeparator,
  MenuLabel,
} from '../../../ui/dropdown'
import { useProjectsStore, useCurrentProject } from '../store'
import { formatRelativeTime } from '../../../core/format'
import { ConfirmDialog, type ConfirmRequest } from '../../library/components/ConfirmDialog'
import type { ProjectDoc, WorkspaceKind } from '../../../core/db/schema'
import type { ReactNode } from 'react'

/**
 * Header project switcher: dropdown of recent projects plus create/sample
 * actions. The active project is persisted, so reopening the app restores it.
 */
export function ProjectSwitcher({ onManage }: { onManage: () => void }): ReactNode {
  const projects = useProjectsStore((s) => s.projects)
  const current = useCurrentProject()
  const openProject = useProjectsStore((s) => s.open)
  const createProject = useProjectsStore((s) => s.create)
  const [newName, setNewName] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submitCreate(workspace: WorkspaceKind = 'photo'): Promise<void> {
    setBusy(true)
    try {
      await createProject(newName.trim() || 'Untitled Project', workspace)
      setCreateOpen(false)
      setNewName('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Dropdown>
        <DropdownTrigger asChild>
          <button
            type="button"
            className="flex h-8 max-w-20 items-center gap-1.5 rounded-md px-2 text-xs text-hi transition-colors hover:bg-hover min-[380px]:max-w-24 sm:max-w-64 sm:text-sm"
            aria-haspopup="menu"
            title="Switch project"
          >
            <span className="truncate font-medium">{current ? current.name : 'Frame Studio'}</span>
            <MoreHorizontal size={14} className="shrink-0 text-lo" />
          </button>
        </DropdownTrigger>
        <DropdownContent align="start" className="min-w-72">
          <MenuLabel>Projects</MenuLabel>
          {projects.length === 0 ? (
            <p className="px-2.5 py-2 text-xs text-lo">No projects yet — create one below.</p>
          ) : (
            projects.slice(0, 6).map((p) => (
              <MenuItem key={p.id} onSelect={() => openProject(p.id)} className="gap-1">
                {p.id === current?.id ? <Check size={13} className="shrink-0 text-accent" /> : <span className="w-[13px]" />}
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="shrink-0 text-[10px] text-lo">{formatRelativeTime(p.updatedAt)}</span>
              </MenuItem>
            ))
          )}
          {projects.length > 6 ? (
            <MenuItem onSelect={onManage}>Show all {projects.length} projects…</MenuItem>
          ) : null}
          <MenuSeparator />
          <MenuItem icon={<Plus size={13} />} onSelect={() => setCreateOpen(true)}>
            New project…
          </MenuItem>
          <MenuItem icon={<FolderOpen size={13} />} onSelect={onManage}>
            Manage projects…
          </MenuItem>
          <MenuItem
            icon={<Sparkles size={13} />}
            disabled={busy}
            onSelect={() => {
              setBusy(true)
              useProjectsStore
                .getState()
                .createSample()
                .catch((err: unknown) =>
                  console.error('Sample project creation failed', err),
                )
                .finally(() => setBusy(false))
            }}
          >
            Create sample project
          </MenuItem>
        </DropdownContent>
      </Dropdown>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        {createOpen ? (
          <DialogContent
            title="New project"
            description="Projects hold their own lists of assets and edit operations. The media library is shared between them."
            footer={
              <>
                <Button variant="subtle" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button variant="primary" disabled={busy} onClick={() => void submitCreate('photo')}>
                  Create
                </Button>
              </>
            }
          >
            <label className="block space-y-1.5">
              <span className="block text-xs text-lo">Project name</span>
              <Input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitCreate('photo')
                }}
                placeholder="Untitled Project"
              />
            </label>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  )
}

/**
 * Manage-projects dialog: full list with open, rename, duplicate, delete.
 */
export function ManageProjectsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}): ReactNode {
  const projects = useProjectsStore((s) => s.projects)
  const currentId = useProjectsStore((s) => s.currentId)
  const [renaming, setRenaming] = useState<ProjectDoc | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)

  function handleRenameSubmit(): void {
    if (renaming) {
      useProjectsStore.getState().rename(renaming.id, renameValue)
    }
    setRenaming(null)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        {open ? (
          <DialogContent
            title="Projects"
            description="All data lives locally in your browser and autosaves while you work."
            wide
          >
            {projects.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line p-8 text-center text-sm text-lo">
                No projects yet — create one from the project switcher.
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {projects.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-sm font-medium text-hi">
                        <span className="truncate">{p.name}</span>
                        {p.id === currentId ? (
                          <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent">
                            Active
                          </span>
                        ) : null}
                      </p>
                      <p className="text-xs text-lo">
                        {p.photoAssets.length} photo{p.photoAssets.length === 1 ? '' : 's'} ·{' '}
                        {p.videoAssets.length} video/audio · updated {formatRelativeTime(p.updatedAt)}
                      </p>
                    </div>
                    <Dropdown>
                      <DropdownTrigger asChild>
                        <Button size="icon" variant="ghost" aria-label={`Actions for ${p.name}`}>
                          <MoreHorizontal size={14} />
                        </Button>
                      </DropdownTrigger>
                      <DropdownContent align="end">
                        <MenuItem
                          icon={<FolderOpen size={13} />}
                          onSelect={() => {
                            useProjectsStore.getState().open(p.id)
                            onOpenChange(false)
                          }}
                        >
                          Open
                        </MenuItem>
                        <MenuItem
                          icon={<PenLine size={13} />}
                          onSelect={() => {
                            setRenaming(p)
                            setRenameValue(p.name)
                          }}
                        >
                          Rename…
                        </MenuItem>
                        <MenuItem
                          icon={<Copy size={13} />}
                          onSelect={() => void useProjectsStore.getState().duplicate(p.id)}
                        >
                          Duplicate
                        </MenuItem>
                        <MenuSeparator />
                        <MenuItem
                          danger
                          icon={<Trash2 size={13} />}
                          onSelect={() => {
                            setConfirm({
                              title: `Delete project "${p.name}"?`,
                              description:
                                'Edit operations and the timeline of this project are deleted. Library media itself is kept.',
                              confirmLabel: 'Delete project',
                              danger: true,
                              onConfirm: () => useProjectsStore.getState().remove(p.id),
                            })
                          }}
                        >
                          Delete
                        </MenuItem>
                      </DropdownContent>
                    </Dropdown>
                  </li>
                ))}
              </ul>
            )}
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog open={renaming !== null} onOpenChange={(o) => (o ? undefined : setRenaming(null))}>
        {renaming ? (
          <DialogContent
            title="Rename project"
            footer={
              <>
                <Button variant="subtle" onClick={() => setRenaming(null)}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={handleRenameSubmit}>
                  Rename
                </Button>
              </>
            }
          >
            <Input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameSubmit()
              }}
            />
          </DialogContent>
        ) : null}
      </Dialog>

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </>
  )
}
