// Acceso a datos: autenticación con Firebase y entradas cifradas en Firestore.
//
// users/{uid}               { wrappedKey }       clave del llavero, envuelta con la contraseña maestra
// users/{uid}/items/{id}    { data, updatedAt }  cada entrada cifrada con AES-256-GCM
import { FirebaseError } from 'firebase/app'
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut as fbSignOut } from 'firebase/auth'
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore/lite'
import { createVaultKey, decryptJson, deriveMasterKeys, encryptJson, normalizeEmail, unwrapVaultKey } from './crypto'
import { auth, db } from './firebase'

export interface ItemData {
  title: string
  url: string
  username: string
  password: string
  /** Secreto base32 o URI otpauth:// */
  totp: string
  notes: string
  tags: string[]
}

export interface Item extends ItemData {
  id: string
  updatedAt: string
}

export interface OpenVault {
  userId: string
  email: string
  key: CryptoKey
}

export const MIN_MASTER_LENGTH = 10

function friendlyError(err: unknown): Error {
  const code = err instanceof FirebaseError ? err.code : ''
  const messages: Record<string, string> = {
    'auth/invalid-credential': 'Email o contraseña maestra incorrectos.',
    'auth/wrong-password': 'Email o contraseña maestra incorrectos.',
    'auth/user-not-found': 'Email o contraseña maestra incorrectos.',
    'auth/invalid-email': 'El email no es válido.',
    'auth/email-already-in-use': 'Ya existe un llavero con ese email. Entra con tu contraseña maestra.',
    'auth/too-many-requests': 'Demasiados intentos. Espera un poco y vuelve a probar.',
    'auth/network-request-failed': 'Sin conexión. Revisa tu internet.',
    'permission-denied': 'Permiso denegado por el servidor.',
    unavailable: 'Sin conexión con el servidor.',
  }
  if (messages[code]) return new Error(messages[code])
  return err instanceof Error ? err : new Error('Algo ha fallado. Inténtalo de nuevo.')
}

/** Crea la cuenta y abre el llavero. */
export async function register(email: string, master: string): Promise<OpenVault> {
  if (master.length < MIN_MASTER_LENGTH) throw new Error(`La contraseña maestra debe tener al menos ${MIN_MASTER_LENGTH} caracteres.`)
  const keys = await deriveMasterKeys(email, master)
  try {
    const cred = await createUserWithEmailAndPassword(auth, normalizeEmail(email), keys.authPassword)
    return await loadOrCreateKey(cred.user.uid, email, keys.wrapKey)
  } catch (err) {
    throw friendlyError(err)
  }
}

/**
 * Inicia sesión y abre el llavero. Siempre verifica la contraseña maestra contra Firebase
 * antes de tocar la clave, para no crear nunca una clave con una contraseña equivocada.
 */
export async function openVault(email: string, master: string): Promise<OpenVault> {
  const keys = await deriveMasterKeys(email, master)
  try {
    const cred = await signInWithEmailAndPassword(auth, normalizeEmail(email), keys.authPassword)
    return await loadOrCreateKey(cred.user.uid, email, keys.wrapKey)
  } catch (err) {
    throw friendlyError(err)
  }
}

async function loadOrCreateKey(userId: string, email: string, wrapKey: CryptoKey, retried = false): Promise<OpenVault> {
  const ref = doc(db, 'users', userId)
  const snap = await getDoc(ref)
  const wrapped = snap.get('wrappedKey') as string | undefined
  if (wrapped) {
    try {
      return { userId, email: normalizeEmail(email), key: await unwrapVaultKey(wrapKey, wrapped, userId) }
    } catch {
      throw new Error('No se pudo descifrar el llavero con esta contraseña maestra.')
    }
  }

  // Primera vez: se crea la clave del llavero. Las reglas solo permiten crearla, nunca sobrescribirla.
  const { vaultKey, wrapped: newWrapped } = await createVaultKey(wrapKey, userId)
  try {
    await setDoc(ref, { wrappedKey: newWrapped })
  } catch (err) {
    // Otro dispositivo la creó a la vez: se usa la suya.
    if (!retried && err instanceof FirebaseError && err.code === 'permission-denied') return loadOrCreateKey(userId, email, wrapKey, true)
    throw err
  }
  return { userId, email: normalizeEmail(email), key: vaultKey }
}

/** Email de la sesión guardada en este navegador, si la hay. */
export async function currentSessionEmail(): Promise<string | null> {
  await auth.authStateReady()
  return auth.currentUser?.email ?? null
}

export async function signOut(): Promise<void> {
  await fbSignOut(auth)
}

export interface LoadResult {
  items: Item[]
  /** Entradas que no se pudieron descifrar (datos dañados). */
  failed: number
}

const itemsOf = (vault: OpenVault) => collection(db, 'users', vault.userId, 'items')

function isoOf(value: unknown): string {
  return value instanceof Timestamp ? value.toDate().toISOString() : new Date().toISOString()
}

export async function loadItems(vault: OpenVault): Promise<LoadResult> {
  try {
    const snap = await getDocs(itemsOf(vault))
    const results = await Promise.allSettled(
      snap.docs.map(async (d) => ({
        ...(await decryptJson<ItemData>(vault.key, d.id, d.get('data'))),
        id: d.id,
        updatedAt: isoOf(d.get('updatedAt')),
      })),
    )
    const items = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    return { items, failed: results.length - items.length }
  } catch (err) {
    throw friendlyError(err)
  }
}

export async function saveItem(vault: OpenVault, id: string, item: ItemData): Promise<Item> {
  const data = await encryptJson(vault.key, id, item)
  try {
    await setDoc(doc(itemsOf(vault), id), { data, updatedAt: serverTimestamp() })
  } catch (err) {
    throw friendlyError(err)
  }
  return { ...item, id, updatedAt: new Date().toISOString() }
}

export async function deleteItem(vault: OpenVault, id: string): Promise<void> {
  try {
    await deleteDoc(doc(itemsOf(vault), id))
  } catch (err) {
    throw friendlyError(err)
  }
}
