// Estado compartido entre el popup y el proceso de fondo de la extensión.
// Todo vive en chrome.storage.session (memoria; no accesible desde las páginas web).

/** Inicio de sesión detectado en una pestaña, pendiente de guardar. */
export interface PendingLogin {
  host: string
  username: string
  password: string
  at: number
}

/** Usuario escrito en el primer paso de un login en dos pasos (email → contraseña). */
export interface PendingUser {
  host: string
  username: string
  at: number
}

export const PENDING_TTL = 5 * 60 * 1000
export const USER_TTL = 10 * 60 * 1000

export const keys = {
  pending: (tabId: number) => `pending:${tabId}`,
  user: (tabId: number) => `user:${tabId}`,
  /** Huella del último relleno hecho por Llavero en la pestaña (para no ofrecer guardar lo que ya está). */
  filled: (tabId: number) => `filled:${tabId}`,
}

export function siteHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '')
}

/** Huella SHA-256: permite comparar sin guardar la contraseña en claro. */
export async function fingerprint(host: string, username: string, password: string): Promise<string> {
  const data = new TextEncoder().encode([host, username.toLowerCase(), password].join('\u0000'))
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function sessionGet<T>(key: string): Promise<T | undefined> {
  return ((await chrome.storage.session.get(key)) as Record<string, T>)[key]
}

/** Webs en las que elegiste "Nunca para esta web". */
export async function getNeverSave(): Promise<string[]> {
  const { neverSave } = (await chrome.storage.local.get('neverSave')) as { neverSave?: string[] }
  return neverSave ?? []
}

export async function setNeverSave(host: string, never: boolean): Promise<void> {
  const list = (await getNeverSave()).filter((h) => h !== host)
  await chrome.storage.local.set({ neverSave: never ? [...list, host] : list })
}
