import { useState, useEffect, useRef } from 'react'
import { Check, Copy, Download, FolderOpen, MoreHorizontal, PenLine, Plus, Sparkles, Trash2, Upload } from 'lucide-react'
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
import { deleteAssetCompletely } from '../../library/import'
import { db } from '../../../core/db/schema'
import { exportProjectBackup, importProjectBackup } from '../../library/backup'
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
  const [busy, setBusy] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [storage, setStorage] = useState<{ usageMB: number | null; unusedCount: number; unusedMB: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Storage census: origin usage + media not referenced by any project.
  const refreshStorage = async (): Promise<void> => {
    try {
      const est = await navigator.storage?.estimate?.()
      const usageMB = est?.usage ? Math.round((est.usage / (1024 * 1024)) * 10) / 10 : null
      const [assets, projects] = await Promise.all([db.assets.toArray(), db.projects.toArray()])
      const referenced = new Set<string>()
      for (const p of projects) for (const id of [...p.photoAssets, ...p.videoAssets]) referenced.add(id)
      const unused = assets.filter((a) => !referenced.has(a.id))
      setStorage({
        usageMB,
        unusedCount: unused.length,
        unusedMB: Math.round((unused.reduce((s, a) => s + a.size, 0) / (1024 * 1024)) * 10) / 10,
      })
    } catch {
      setStorage(null)
    }
  }

  const clearUnusedMedia = async (): Promise<void> => {
    setBusy('storage')
    try {
      const [assets, projects] = await Promise.all([db.assets.toArray(), db.projects.toArray()])
      const referenced = new Set<string>()
      for (const p of projects) for (const id of [...p.photoAssets, ...p.videoAssets]) referenced.add(id)
      for (const a of assets) if (!referenced.has(a.id)) await deleteAssetCompletely(a.id)
      await refreshStorage()
      await useProjectsStore.getState().reload()
    } finally {
      setBusy(null)
    }
  }

  /** Most recent backup timestamp across projects (localStorage). */
  const lastBackupAt = Number(window.localStorage.getItem('fs.lastBackupAt') ?? 0)
  const backupStale = Date.now() - lastBackupAt > 14 * 24 * 60 * 60 * 1000

  const backup = async (id: string): Promise<void> => {
    setBusy(id)
    setImportError(null)
    try {
      await exportProjectBackup(id)
      window.localStorage.setItem('fs.lastBackupAt', String(Date.now()))
    } catch {
      setImportError('Backup failed — could not read the project media.')
    } finally {
      setBusy(null)
    }
  }

  const importBackup = async (file: File): Promise<void> => {
    setBusy('import')
    setImportError(null)
    try {
      const json: unknown = JSON.parse(await file.text())
      const id = await importProjectBackup(json)
      await useProjectsStore.getState().reload()
      useProjectsStore.getState().open(id)
      onOpenChange(false)
    } catch (err) {
      setImportError(err instanceof Error && err.message !== 'Unexpected token' ? err.message : 'Import failed — is this a Frame Studio backup file?')
    } finally {
      setBusy(null)
    }
  }

  function handleRenameSubmit(): void {
    if (renaming) {
      useProjectsStore.getState().rename(renaming.id, renameValue)
    }
    setRenaming(null)
  }

  useEffect(() => {
    if (open) void refreshStorage()
  }, [open])

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        {open ? (
          <DialogContent
            title="Projects"
            description="All data lives locally in your browser and autosaves while you work."
            wide
          >
            {/* Local backup: one file out, one file in — nothing is uploaded. */}
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-elevated/50 px-3 py-2">
              <span className="min-w-0 flex-1 text-xs text-lo">
                Back up a project to a file you keep (Files, Drive, anywhere) — or restore one here. Stays on-device.
                {lastBackupAt > 0 ? ` Last backup: ${formatRelativeTime(lastBackupAt)}.` : ''}
                {backupStale ? ' Over two weeks — worth a fresh backup.' : ''}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) void importBackup(file)
                }}
              />
              <Button size="sm" variant="subtle" disabled={busy === 'import'} onClick={() => fileInputRef.current?.click()}>
                <Upload size={13} />
                {busy === 'import' ? 'Restoring…' : 'Restore backup'}
              </Button>
            </div>
            {/* Storage census: origin usage + unused media cleanup. */}
            {storage && (storage.usageMB !== null || storage.unusedCount > 0) ? (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-elevated/50 px-3 py-2">
                <span className="min-w-0 flex-1 text-xs text-lo">
                  {storage.usageMB !== null ? `Browser storage used: ${storage.usageMB} MB.` : ''}
                  {storage.unusedCount > 0
                    ? ` ${storage.unusedCount} unused media item${storage.unusedCount === 1 ? '' : 's'} (${storage.unusedMB} MB) can be cleared.`
                    : ' No unused media.'}
                </span>
                {storage.unusedCount > 0 ? (
                  <Button
                    size="sm"
                    variant="subtle"
                    disabled={busy === 'storage'}
                    onClick={() =>
                      setConfirm({
                        title: `Clear ${storage.unusedCount} unused media item${storage.unusedCount === 1 ? '' : 's'}?`,
                        description:
                          'These files are not used by any project. Projects and edits are untouched. This cannot be undone.',
                        confirmLabel: 'Clear media',
                        danger: true,
                        onConfirm: () => void clearUnusedMedia(),
                      })
                    }
                  >
                    <Trash2 size={13} />
                    {busy === 'storage' ? 'Clearing…' : 'Clear unused'}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {importError ? (
              <p className="mb-3 rounded-md bg-red-500/10 px-3 py-1.5 text-xs text-red-400" role="alert">
                {importError}
              </p>
            ) : null}
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
                        <MenuItem
                          icon={<Download size={13} />}
                          disabled={busy === p.id}
                          onSelect={() => void backup(p.id)}
                        >
                          {busy === p.id ? 'Backing up…' : 'Backup file…'}
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
