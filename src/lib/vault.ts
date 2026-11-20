// Acceso a datos: autenticación con Firebase y entradas cifradas en Firestore.
//
// users/{uid}               { wrappedKey, nextWrappedKey? }  clave del llavero, envuelta con la contraseña maestra
//                           (nextWrappedKey: la misma clave con la maestra nueva, solo mientras se cambia)
// users/{uid}/items/{id}    { data, updatedAt }  cada entrada cifrada con AES-256-GCM
import { FirebaseError } from 'firebase/app'
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  updatePassword,
} from 'firebase/auth'
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore/lite'
import { createVaultKey, decryptJson, deriveMasterKeys, encryptJson, normalizeEmail, rewrapVaultKey, unwrapVaultKey } from './crypto'
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
    'auth/requires-recent-login': 'Por seguridad, bloquea el llavero, vuelve a entrar y repítelo.',
    'permission-denied': 'Permiso denegado por el servidor.',
    unavailable: 'Sin conexión con el servidor.',
  }
  if (messages[code]) return new Error(messages[code])
  return err instanceof Error ? err : new Error('Algo ha fallado. Inténtalo de nuevo.')
}

/** Crea la cuenta y abre el llavero. */
export async function register(email: string, master: string, extractable = false): Promise<OpenVault> {
  if (master.length < MIN_MASTER_LENGTH) throw new Error(`La contraseña maestra debe tener al menos ${MIN_MASTER_LENGTH} caracteres.`)
  const keys = await deriveMasterKeys(email, master)
  try {
    const cred = await createUserWithEmailAndPassword(auth, normalizeEmail(email), keys.authPassword)
    return await loadOrCreateKey(cred.user.uid, email, keys.wrapKey, extractable)
  } catch (err) {
    throw friendlyError(err)
  }
}

/**
 * Inicia sesión y abre el llavero. Siempre verifica la contraseña maestra contra Firebase
 * antes de tocar la clave, para no crear nunca una clave con una contraseña equivocada.
 */
export async function openVault(email: string, master: string, extractable = false): Promise<OpenVault> {
  const keys = await deriveMasterKeys(email, master)
  try {
    const cred = await signInWithEmailAndPassword(auth, normalizeEmail(email), keys.authPassword)
    return await loadOrCreateKey(cred.user.uid, email, keys.wrapKey, extractable)
  } catch (err) {
    throw friendlyError(err)
  }
}

async function loadOrCreateKey(userId: string, email: string, wrapKey: CryptoKey, extractable: boolean, retried = false): Promise<OpenVault> {
  const ref = doc(db, 'users', userId)
  const snap = await getDoc(ref)
  const wrapped = snap.get('wrappedKey') as string | undefined
  if (wrapped) {
    const unwrap = (w: string) => unwrapVaultKey(wrapKey, w, userId, extractable)
    try {
      return { userId, email: normalizeEmail(email), key: await unwrap(wrapped) }
    } catch {
      // Un cambio de contraseña maestra se cortó después de cambiar el login: se termina ahora.
      const next = snap.get('nextWrappedKey') as string | undefined
      const key = next ? await unwrap(next).catch(() => null) : null
      if (!next || !key) throw new Error('No se pudo descifrar el llavero con esta contraseña maestra.')
      await setDoc(ref, { wrappedKey: next }).catch(() => {})
      return { userId, email: normalizeEmail(email), key }
    }
  }

  // Primera vez: se crea la clave del llavero. Las reglas no dejan sobrescribirla de golpe.
  const { vaultKey, wrapped: newWrapped } = await createVaultKey(wrapKey, userId, extractable)
  try {
    await setDoc(ref, { wrappedKey: newWrapped })
  } catch (err) {
    // Otro dispositivo la creó a la vez: se usa la suya.
    if (!retried && err instanceof FirebaseError && err.code === 'permission-denied') return loadOrCreateKey(userId, email, wrapKey, extractable, true)
    throw err
  }
  return { userId, email: normalizeEmail(email), key: vaultKey }
}

/** Comprueba la contraseña maestra con el servidor (antes de acciones delicadas). */
async function reauthenticate(vault: OpenVault, master: string) {
  const user = auth.currentUser
  if (!user || user.uid !== vault.userId) throw new Error('La sesión ha caducado. Bloquea el llavero y vuelve a entrar.')
  const keys = await deriveMasterKeys(vault.email, master)
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(vault.email, keys.authPassword))
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : ''
    if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-mismatch'].includes(code)) throw new Error('La contraseña maestra no es correcta.')
    throw friendlyError(err)
  }
  return { user, keys }
}

export async function verifyMaster(vault: OpenVault, master: string): Promise<void> {
  await reauthenticate(vault, master)
}

/**
 * Cambia la contraseña maestra. La clave del llavero sigue siendo la misma, así que las entradas
 * no se tocan: solo cambian la contraseña de login y el envoltorio de la clave.
 *
 * Auth y Firestore no comparten transacción, así que el orden evita quedarse fuera:
 * 1) se guarda la clave envuelta con la nueva junto a la actual, 2) se cambia el login,
 * 3) se deja solo la nueva. Si se corta a medias, entras con la maestra que tenga el login
 * y ese inicio de sesión termina el cambio (ver loadOrCreateKey).
 */
export async function changeMaster(vault: OpenVault, currentMaster: string, newMaster: string): Promise<void> {
  if (newMaster.length < MIN_MASTER_LENGTH) throw new Error(`La contraseña maestra debe tener al menos ${MIN_MASTER_LENGTH} caracteres.`)
  if (newMaster === currentMaster) throw new Error('La nueva contraseña maestra es igual a la actual.')
  const { user, keys } = await reauthenticate(vault, currentMaster)
  const next = await deriveMasterKeys(vault.email, newMaster)
  const ref = doc(db, 'users', vault.userId)
  try {
    const wrapped = (await getDoc(ref)).get('wrappedKey') as string | undefined
    if (!wrapped) throw new Error('No se encontró la clave del llavero.')
    const nextWrapped = await rewrapVaultKey(keys.wrapKey, next.wrapKey, wrapped, vault.userId)
    await setDoc(ref, { wrappedKey: wrapped, nextWrappedKey: nextWrapped })
    await updatePassword(user, next.authPassword)
    await setDoc(ref, { wrappedKey: nextWrapped })
  } catch (err) {
    throw friendlyError(err)
  }
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

/** Guarda muchas entradas nuevas (importación), unas pocas a la vez. Las que fallan se cuentan. */
export async function saveNewItems(
  vault: OpenVault,
  list: ItemData[],
  onProgress: (done: number) => void,
): Promise<{ saved: Item[]; failed: number }> {
  const saved: Item[] = []
  let failed = 0
  for (let i = 0; i < list.length; i += 10) {
    const results = await Promise.allSettled(list.slice(i, i + 10).map((data) => saveItem(vault, crypto.randomUUID(), data)))
    for (const r of results) r.status === 'fulfilled' ? saved.push(r.value) : failed++
    onProgress(saved.length + failed)
  }
  return { saved, failed }
}

export async function deleteItem(vault: OpenVault, id: string): Promise<void> {
  try {
    await deleteDoc(doc(itemsOf(vault), id))
  } catch (err) {
    throw friendlyError(err)
  }
}
