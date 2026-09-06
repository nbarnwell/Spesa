export function newId(): string {
  return crypto.randomUUID()
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function normalizeProductName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}
