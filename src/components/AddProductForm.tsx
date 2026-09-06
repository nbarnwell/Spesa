import { useState, type FormEvent } from 'react'

interface AddProductFormProps {
  placeholder?: string
  submitLabel?: string
  onAdd: (name: string) => Promise<void> | void
}

export function AddProductForm({
  placeholder = 'Add item…',
  submitLabel = 'Add',
  onAdd,
}: AddProductFormProps) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      await onAdd(trimmed)
      setName('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="add-form" onSubmit={(e) => void handleSubmit(e)}>
      <input
        className="add-form__input"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={placeholder}
        enterKeyHint="done"
        autoComplete="off"
        disabled={busy}
      />
      <button className="btn btn--primary" type="submit" disabled={busy || !name.trim()}>
        {submitLabel}
      </button>
    </form>
  )
}
