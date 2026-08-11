import { useApp } from '../store/app.js'

const TONE: Record<string, string> = {
  info: 'border-line bg-surface text-muted',
  success: 'border-ok/40 bg-surface text-ink',
  error: 'border-bad/50 bg-surface text-ink'
}

export function Toasts(): React.ReactElement {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)

  return (
    <div
      className="pointer-events-none fixed top-3 right-3 z-50 flex w-80 flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          onClick={() => dismiss(toast.id)}
          className={`fg-slide-in pointer-events-auto rounded-lg border px-3 py-2 text-left text-[12.5px] shadow-lg hover:-translate-x-0.5 ${
            TONE[toast.kind] ?? TONE.info
          }`}
        >
          {toast.message}
        </button>
      ))}
    </div>
  )
}
