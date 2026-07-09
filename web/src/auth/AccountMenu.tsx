import { useEffect, useRef, useState } from 'react'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '../components/ui/drawer'
import { Camera } from 'lucide-react'
import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from '../components/ui/avatar'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import { useAuth } from './AuthProvider'
import { ProfileSetup } from './ProfileSetup'
import { SignInDialog } from './SignInDialog'
import { AvatarImageError, processAvatarFile, type ProcessedAvatar } from './avatarImage'
import { deleteAvatarObject, uploadAvatar } from './avatarStorage'
import { memberInitials } from '../sessions/sessionsTypes'
import { refreshActiveSession } from '../sessions/sessionsStore'

const MAX_DISPLAY_NAME = 50

/**
 * The account control in the app header. Three states, mirroring iOS:
 *   • signedOut           → "Sign in" opens the sign-in modal.
 *   • signedInNoProfile   → "Finish profile" opens profile setup.
 *   • signedInWithProfile → an avatar button opens a right-side drawer with a profile
 *     summary that swaps inline to an edit view (display name + avatar upload/remove).
 *
 * The whole app stays usable without signing in; during restore we render a placeholder
 * so the header never flashes "Sign in".
 */
export function AccountMenu() {
  const { status, profile, isRestoring, signOut, deleteAccount, saveProfile } = useAuth()

  const [showSignIn, setShowSignIn] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [menuError, setMenuError] = useState<string | null>(null)

  // Inline edit-view state (mode === 'edit').
  const [mode, setMode] = useState<'menu' | 'edit'>('menu')
  const [nameDraft, setNameDraft] = useState('')
  const [initialName, setInitialName] = useState('')
  const [staged, setStaged] = useState<ProcessedAvatar | null>(null)
  const [removeRequested, setRemoveRequested] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const editButtonRef = useRef<HTMLButtonElement>(null)

  // Revoke a still-staged preview object URL if the menu unmounts mid-edit (all the normal
  // close/cancel/save/re-pick paths already revoke). Ref-based so it only fires on unmount.
  const stagedRef = useRef<ProcessedAvatar | null>(null)
  stagedRef.current = staged
  useEffect(() => {
    return () => {
      if (stagedRef.current) URL.revokeObjectURL(stagedRef.current.previewUrl)
    }
  }, [])

  // Once a session lands, close the sign-in modal and hand off to profile setup for a
  // brand-new account. When a full profile resolves, ensure setup is closed.
  useEffect(() => {
    if (status === 'signedOut') return
    setShowSignIn(false)
    setShowProfile(status === 'signedInNoProfile')
  }, [status])

  // Focus management across the inline swap: edit → the name field; menu → the Edit button.
  useEffect(() => {
    if (!showMenu) return
    if (mode === 'edit') nameInputRef.current?.focus()
    else editButtonRef.current?.focus()
  }, [mode, showMenu])

  function resetEdit() {
    if (staged) URL.revokeObjectURL(staged.previewUrl)
    setStaged(null)
    setRemoveRequested(false)
    setEditError(null)
    setConfirmingDiscard(false)
    setSaving(false)
    setMode('menu')
  }

  function closeMenu() {
    resetEdit()
    setShowMenu(false)
    setConfirmingDelete(false)
    setMenuError(null)
  }

  // Pending edits worth guarding against an accidental swipe/backdrop dismiss.
  function hasPendingEdits() {
    return staged !== null || removeRequested || nameDraft.trim() !== initialName.trim()
  }

  function requestClose() {
    if (saving) return // never yank the drawer out mid-save
    if (mode === 'edit' && hasPendingEdits() && !confirmingDiscard) {
      setConfirmingDiscard(true)
      return
    }
    closeMenu()
  }

  function openEdit() {
    if (!profile) return
    // Pre-fill with the display name, or the handle when it's empty — so a user with a
    // legacy empty display_name is never blocked on a photo-only edit (R5).
    const seed = profile.displayName.trim() || profile.handle
    setNameDraft(seed)
    setInitialName(seed)
    setStaged(null)
    setRemoveRequested(false)
    setEditError(null)
    setConfirmingDiscard(false)
    setMode('edit')
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    setEditError(null)
    try {
      const next = await processAvatarFile(file)
      if (staged) URL.revokeObjectURL(staged.previewUrl)
      setStaged(next)
      setRemoveRequested(false)
    } catch (err) {
      setEditError(err instanceof AvatarImageError ? err.message : 'Could not read that image.')
    }
  }

  function onRemovePhoto() {
    if (staged) URL.revokeObjectURL(staged.previewUrl)
    setStaged(null)
    setRemoveRequested(true)
    setEditError(null)
  }

  async function handleSave() {
    if (!profile) return
    const name = nameDraft.trim()
    if (!name) {
      setEditError('Enter a display name.')
      return
    }
    setSaving(true)
    setEditError(null)

    // Decide the new avatar value: a fresh upload, an explicit removal (null), or unchanged.
    let newPath: string | null | undefined
    try {
      if (staged) newPath = (await uploadAvatar(profile.id, staged.blob)).path
      else if (removeRequested) newPath = null
      else newPath = undefined

      const oldPath = profile.avatarPath
      try {
        await saveProfile(profile.handle, name, newPath)
      } catch (persistErr) {
        // Persist failed after the object landed — clean up the orphan we just made.
        if (newPath) await deleteAvatarObject(newPath)
        throw persistErr
      }

      // Persisted: reclaim the previous object (if the avatar actually changed), refresh the
      // roster so the user's own session chip updates, then return to the menu.
      if (newPath !== undefined && oldPath && oldPath !== newPath) {
        await deleteAvatarObject(oldPath)
      }
      void refreshActiveSession().catch(() => {})
      resetEdit()
    } catch {
      setEditError("Couldn't save your profile. Please try again.")
      setSaving(false)
    }
  }

  async function handleSignOut() {
    try {
      await signOut()
    } catch {
      // Signing out is best-effort; the auth listener reconciles state either way.
    }
    closeMenu()
  }

  async function handleDelete() {
    setMenuError(null)
    try {
      await deleteAccount()
      closeMenu()
    } catch {
      setMenuError("Couldn't delete your account. Please try again.")
    }
  }

  // Reserve the same footprint during restore so the header doesn't jump.
  if (isRestoring) return <div className="h-8" aria-hidden="true" />

  const initials = profile
    ? memberInitials({ displayName: profile.displayName, handle: profile.handle, userId: profile.id })
    : ''
  // In edit mode the preview is the staged photo → else the current avatar (unless removed).
  const editPreviewUrl = staged?.previewUrl ?? (removeRequested ? null : profile?.avatarUrl ?? null)
  const canRemove = !staged && !removeRequested && Boolean(profile?.avatarUrl)

  return (
    <>
      {status === 'signedOut' && (
        <Button variant="outline" size="sm" onClick={() => setShowSignIn(true)}>
          Sign in
        </Button>
      )}

      {status === 'signedInNoProfile' && (
        <Button variant="outline" size="sm" onClick={() => setShowProfile(true)}>
          Finish profile
        </Button>
      )}

      {status === 'signedInWithProfile' && profile && (
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-full" // ≥44px-friendly tap target around the sm avatar
          aria-haspopup="menu"
          aria-label={profile.displayName.trim() || `@${profile.handle}`}
          onClick={() => setShowMenu(true)}
        >
          <Avatar size="sm">
            {profile.avatarUrl && <AvatarImage src={profile.avatarUrl} alt="" />}
            <AvatarFallback className="bg-primary/15 font-semibold text-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
        </Button>
      )}

      {/* Sign-in modal — kept consistent with the log-ascent sign-in surface */}
      <SignInDialog open={showSignIn} onOpenChange={setShowSignIn} />

      {/* Profile setup drawer */}
      <Drawer open={showProfile} onOpenChange={setShowProfile} showSwipeHandle>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Set up your profile</DrawerTitle>
          </DrawerHeader>
          <ProfileSetup onDone={() => setShowProfile(false)} />
        </DrawerContent>
      </Drawer>

      {/* Signed-in account drawer — slides in from the right; inline menu ⇄ edit. */}
      <Drawer
        open={showMenu}
        onOpenChange={(open) => (open ? setShowMenu(true) : requestClose())}
        swipeDirection="right"
      >
        <DrawerContent>
          <DrawerHeader className="pb-4">
            {/* In the menu view the identity is shown by the summary header below, so the
                title is visually hidden (kept for the drawer's accessible name). */}
            <DrawerTitle className={mode === 'edit' ? undefined : 'sr-only'}>
              {mode === 'edit' ? 'Edit profile' : profile ? `@${profile.handle}` : 'Account'}
            </DrawerTitle>
          </DrawerHeader>

          {mode === 'menu' ? (
            <div className="flex flex-1 flex-col gap-2 px-4 pb-6" role="menu">
              {/* Profile summary header */}
              {profile && (
                <div className="flex items-center gap-3 pb-2">
                  <Avatar size="lg">
                    {profile.avatarUrl && <AvatarImage src={profile.avatarUrl} alt="" />}
                    <AvatarFallback className="bg-primary/15 font-semibold text-foreground">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    {profile.displayName.trim() && (
                      <p className="truncate font-medium text-foreground">{profile.displayName}</p>
                    )}
                    <p className="truncate text-sm text-muted-foreground">@{profile.handle}</p>
                  </div>
                </div>
              )}

              <Button
                ref={editButtonRef}
                variant="outline"
                className="w-full justify-start"
                role="menuitem"
                onClick={openEdit}
              >
                Edit profile
              </Button>

              {/* Account actions pinned to the bottom of the drawer. */}
              <div className="mt-auto flex flex-col gap-2">
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  role="menuitem"
                  onClick={() => void handleSignOut()}
                >
                  Sign out
                </Button>

                {confirmingDelete ? (
                  <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 p-3">
                    <p className="text-sm text-muted-foreground">
                      Delete your account? This permanently removes your profile and cannot
                      be undone.
                    </p>
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
                        Cancel
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => void handleDelete()}>
                        Delete account
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="destructive"
                    className="w-full justify-start"
                    role="menuitem"
                    onClick={() => setConfirmingDelete(true)}
                  >
                    Delete account
                  </Button>
                )}

                {menuError && (
                  <p className="text-sm text-destructive" role="alert">
                    {menuError}
                  </p>
                )}
              </div>
            </div>
          ) : (
            // ── Edit view (a form, not a menu) ──────────────────────────────────
            <div className="flex flex-col gap-4 px-4 pb-6">
              <div className="flex items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void onPickFile(e)}
                />
                {/* The avatar is the affordance: tap it (camera badge) for the photo actions. */}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <button
                        type="button"
                        disabled={saving}
                        aria-label="Edit profile photo"
                        className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                      />
                    }
                  >
                    <Avatar size="lg" className="size-20">
                      {editPreviewUrl && <AvatarImage src={editPreviewUrl} alt="" />}
                      <AvatarFallback className="bg-primary/15 text-lg font-semibold text-foreground">
                        {initials}
                      </AvatarFallback>
                      <AvatarBadge className="size-5! [&>svg]:size-2.5!">
                        <Camera />
                      </AvatarBadge>
                    </Avatar>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-44">
                    <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                      {editPreviewUrl ? 'Change photo' : 'Add photo'}
                    </DropdownMenuItem>
                    {canRemove && (
                      <DropdownMenuItem variant="destructive" onClick={onRemovePhoto}>
                        Remove photo
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="edit-display-name" className="text-sm font-medium text-foreground">
                  Display name
                </label>
                <Input
                  id="edit-display-name"
                  ref={nameInputRef}
                  value={nameDraft}
                  maxLength={MAX_DISPLAY_NAME}
                  disabled={saving}
                  className="text-base md:text-sm"
                  onChange={(e) => setNameDraft(e.target.value)}
                />
              </div>

              {editError && (
                <p className="text-sm text-destructive" role="alert">
                  {editError}
                </p>
              )}

              {confirmingDiscard ? (
                <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                  <p className="text-sm text-muted-foreground">Discard your changes?</p>
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setConfirmingDiscard(false)}>
                      Keep editing
                    </Button>
                    <Button variant="destructive" size="sm" onClick={closeMenu}>
                      Discard
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="ghost"
                    disabled={saving}
                    onClick={() => (hasPendingEdits() ? setConfirmingDiscard(true) : resetEdit())}
                  >
                    Cancel
                  </Button>
                  <Button disabled={saving || !nameDraft.trim()} onClick={() => void handleSave()}>
                    {saving ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              )}
            </div>
          )}
        </DrawerContent>
      </Drawer>
    </>
  )
}
