interface EmptyStateProps {
  icon: string
  title: string
  hint?: string
}

export function EmptyState({ icon, title, hint }: EmptyStateProps) {
  return (
    <div className="empty">
      <span className="empty__icon" aria-hidden>
        {icon}
      </span>
      <p className="empty__title">{title}</p>
      {hint ? <p className="empty__hint">{hint}</p> : null}
    </div>
  )
}
