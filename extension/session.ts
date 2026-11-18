// Mantiene el llavero desbloqueado entre aperturas del popup.
// chrome.storage.session vive solo en memoria: se borra al cerrar el navegador y
// no es accesible desde las páginas web ni desde scripts de contenido.
import { exportVaultKey, fromBase64, importVaultKey } from '../src/lib/crypto'
import { auth } from '../src/lib/firebase'
import type { OpenVault } from '../src/lib/vault'

/** Se bloquea tras este tiempo sin usar la extensión. */
const IDLE_MS = 15 * 60 * 1000

interface Stored {
  userId: string
  email: string
  key: string
  lastUsed: number
}

export async function saveSession(vault: OpenVault): Promise<void> {
  const stored: Stored = { userId: vault.userId, email: vault.email, key: await exportVaultKey(vault.key), lastUsed: Date.now() }
  await chrome.storage.session.set({ vault: stored })
  await chrome.storage.local.set({ lastEmail: vault.email })
}

export async function restoreSession(): Promise<OpenVault | null> {
  const { vault } = (await chrome.storage.session.get('vault')) as { vault?: Stored }
  if (!vault) return null
  await auth.authStateReady()
  if (Date.now() - vault.lastUsed > IDLE_MS || auth.currentUser?.uid !== vault.userId) {
    await clearSession()
    return null
  }
  await touchSession()
  return { userId: vault.userId, email: vault.email, key: await importVaultKey(fromBase64(vault.key), true) }
}

export async function touchSession(): Promise<void> {
  const { vault } = (await chrome.storage.session.get('vault')) as { vault?: Stored }
  if (vault) await chrome.storage.session.set({ vault: { ...vault, lastUsed: Date.now() } })
}

export async function clearSession(): Promise<void> {
  await chrome.storage.session.remove('vault')
}

export async function lastEmail(): Promise<string> {
  const { lastEmail } = (await chrome.storage.local.get('lastEmail')) as { lastEmail?: string }
  return lastEmail ?? ''
}
