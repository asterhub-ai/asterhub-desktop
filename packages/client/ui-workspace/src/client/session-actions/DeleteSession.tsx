/**
 * The session delete action: a `sidebar.workspaces.session.menu.item` row that raises
 * the delete request, and the `shell.overlay` modal dialog entry that confirms and executes it.
 */
import { useState } from 'react'
import { Button, IconTrashOutlineRegular, MenuItemButton, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  DeleteSessionInjected, SessionDeleteDialogInjected, SessionDeleteDialogProps, SessionDeleteTarget,
  SessionMenuItemProps,
} from '../contract/slots.ts'
import css from '../rows/WorkspaceBrowser.module.css'

/**
 * Menu row (order 500): request session deletion dialog.
 * @param props - owner share, menu open state, and delete session share.
 * @returns the menu item button.
 */
export function DeleteSessionMenuItem({
  sessionId, displayTitle, useMenuOpenState, requestSessionDelete, t,
}: SessionMenuItemProps<DeleteSessionInjected>) {
  const [, setMenuOpen] = useMenuOpenState()
  return (
    <MenuItemButton
      danger
      icon={<IconTrashOutlineRegular size={14} />}
      onSelect={() => {
        setMenuOpen(false)
        requestSessionDelete(sessionId, displayTitle)
      }}
    >
      {t('menu.deleteSession')}
    </MenuItemButton>
  )
}

/**
 * The `shell.overlay` entry: confirmation modal dialog for permanently deleting a session.
 * @param props - the request hook, settlement callback, delete method, and locale.
 * @returns the modal or null.
 */
export function SessionDeleteDialog({
  useDeleteRequest, settleSessionDelete, deleteSession, t,
}: SessionDeleteDialogProps) {
  const request = useDeleteRequest(pending => pending)
  if (request === null) return null
  return (
    <DeleteForm
      key={request.sessionId}
      request={request}
      deleteSession={deleteSession}
      onSettle={settleSessionDelete}
      t={t}
    />
  )
}

function DeleteForm({ request, deleteSession, onSettle, t }: {
  request: SessionDeleteTarget
  deleteSession: SessionDeleteDialogInjected['deleteSession']
  onSettle: () => void
  t: SessionDeleteDialogProps['t']
}) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = () => {
    if (deleting) return
    onSettle()
  }
  const confirm = () => {
    if (deleting) return
    setDeleting(true)
    setError(null)
    deleteSession(request.sessionId).then(() => {
      setDeleting(false)
      onSettle()
    }).catch((reason: unknown) => {
      setDeleting(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  return (
    <Modal
      open
      onClose={close}
      closeLabel={t('close')}
      title={t('deleteSession.title')}
      description={t('deleteSession.desc', { title: request.displayTitle })}
      footer={(
        <>
          <Button variant="outline" disabled={deleting} onClick={close}>
            {t('cancel')}
          </Button>
          <Button
            variant="outline"
            className={css.deleteAction}
            disabled={deleting}
            onClick={confirm}
          >
            {t('deleteSession.confirm')}
          </Button>
        </>
      )}
    >
      {deleting && <div className={css.deleteStatus} role="status">{t('deleteSession.pending')}</div>}
      {error !== null && <div className={css.renameError} role="alert">{error}</div>}
    </Modal>
  )
}
