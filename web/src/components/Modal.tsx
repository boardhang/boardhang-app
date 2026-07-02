import { useEffect, useRef, type ReactNode } from 'react'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
}

/**
 * Thin wrapper over the native `<dialog>` element: focus trapping, Escape-to-close, and
 * an inert backdrop come for free from the platform — no focus-management library and
 * no bundle cost. Backdrop clicks and Escape both route through `onClose`.
 */
export function Modal({ title, onClose, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        // A click that lands on the dialog element itself (not its content) is a
        // backdrop click, since the visible card is an inner element.
        if (event.target === ref.current) onClose()
      }}
    >
      <div className="modal-card">
        <header className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        {children}
      </div>
    </dialog>
  )
}
