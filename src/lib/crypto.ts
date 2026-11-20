// Cifrado de extremo a extremo. Todo ocurre en el navegador con WebCrypto.
//
// contraseña maestra + email ──PBKDF2 (600k)──▶ clave raíz
//   clave raíz ──HKDF "auth"──▶ contraseña de login de Firebase (el servidor solo ve esto)
//   clave raíz ──HKDF "wrap"──▶ clave que envuelve la clave del llavero
// clave del llavero (aleatoria, AES-256-GCM) ──▶ cifra cada entrada
//
// El servidor nunca recibe la contraseña maestra ni ninguna clave capaz de descifrar.
// La contraseña de login se deriva por un camino HKDF distinto, así que conocerla
// no permite obtener la clave de envoltura.

const PBKDF2_ITERATIONS = 600_000
const enc = new TextEncoder()
const dec = new TextDecoder()

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export interface MasterKeys {
  /** Se usa como contraseña de la cuenta de Firebase. */
  authPassword: string
  /** Envuelve/desenvuelve la clave del llavero. Nunca sale del navegador. */
  wrapKey: CryptoKey
}

export async function deriveMasterKeys(email: string, masterPassword: string): Promise<MasterKeys> {
  const material = await crypto.subtle.importKey('raw', enc.encode(masterPassword), 'PBKDF2', false, [
    'deriveBits',
  ])
  const rootBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('llavero:' + normalizeEmail(email)), iterations: PBKDF2_ITERATIONS },
    material,
    256,
  )
  const root = await crypto.subtle.importKey('raw', rootBits, 'HKDF', false, ['deriveBits', 'deriveKey'])
  const hkdf = (info: string) => ({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(info) })

  const authBits = await crypto.subtle.deriveBits(hkdf('llavero-auth-v1'), root, 256)
  const wrapKey = await crypto.subtle.deriveKey(hkdf('llavero-wrap-v1'), root, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
  return { authPassword: toHex(new Uint8Array(authBits)), wrapKey }
}

/** AES-GCM con IV aleatorio. Formato: base64(iv[12] || ciphertext+tag). `context` se autentica (AAD). */
async function seal(key: CryptoKey, plaintext: Uint8Array<ArrayBuffer>, context: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(context) }, key, plaintext)
  const out = new Uint8Array(12 + ct.byteLength)
  out.set(iv)
  out.set(new Uint8Array(ct), 12)
  return toBase64(out)
}

/** Lanza un error si la clave es incorrecta o los datos se han manipulado. */
async function open(key: CryptoKey, sealed: string, context: string): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = fromBase64(sealed)
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: enc.encode(context) },
    key,
    bytes.slice(12),
  )
  return new Uint8Array(pt)
}

// `extractable` solo lo usa la extensión, que guarda la clave en memoria de sesión del navegador
// para no pedir la contraseña maestra cada vez que se abre. La web nunca la hace exportable.

export async function createVaultKey(
  wrapKey: CryptoKey,
  userId: string,
  extractable = false,
): Promise<{ vaultKey: CryptoKey; wrapped: string }> {
  const raw = crypto.getRandomValues(new Uint8Array(32))
  const wrapped = await seal(wrapKey, raw, 'vault-key:' + userId)
  const vaultKey = await importVaultKey(raw, extractable)
  raw.fill(0)
  return { vaultKey, wrapped }
}

export async function unwrapVaultKey(wrapKey: CryptoKey, wrapped: string, userId: string, extractable = false): Promise<CryptoKey> {
  const raw = await open(wrapKey, wrapped, 'vault-key:' + userId)
  const key = await importVaultKey(raw, extractable)
  raw.fill(0)
  return key
}

/**
 * Vuelve a envolver la clave del llavero con otra clave (cambio de contraseña maestra).
 * La clave en claro solo existe un instante en memoria; las entradas no cambian.
 */
export async function rewrapVaultKey(oldWrapKey: CryptoKey, newWrapKey: CryptoKey, wrapped: string, userId: string): Promise<string> {
  const raw = await open(oldWrapKey, wrapped, 'vault-key:' + userId)
  try {
    return await seal(newWrapKey, raw, 'vault-key:' + userId)
  } finally {
    raw.fill(0)
  }
}

export function importVaultKey(raw: Uint8Array<ArrayBuffer>, extractable = false): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', extractable, ['encrypt', 'decrypt'])
}

export async function exportVaultKey(key: CryptoKey): Promise<string> {
  return toBase64(new Uint8Array(await crypto.subtle.exportKey('raw', key)))
}

/** Cifra un objeto JSON ligado a su id (así no se puede mover un cifrado a otra entrada). */
export function encryptJson(vaultKey: CryptoKey, id: string, value: unknown): Promise<string> {
  return seal(vaultKey, enc.encode(JSON.stringify(value)), 'item:' + id)
}

export async function decryptJson<T>(vaultKey: CryptoKey, id: string, sealed: string): Promise<T> {
  return JSON.parse(dec.decode(await open(vaultKey, sealed, 'item:' + id))) as T
}

// Copia de seguridad: un archivo que se abre solo con su contraseña, sin cuenta ni servidor.
// Sal aleatoria propia, así no depende del email ni de la clave del llavero.

const BACKUP_FORMAT = 'llavero-backup'
const BACKUP_CONTEXT = 'llavero-backup-v1'

async function backupKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
}

export async function encryptBackup(password: string, value: unknown): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await backupKey(password, salt, PBKDF2_ITERATIONS)
  const data = await seal(key, enc.encode(JSON.stringify(value)), BACKUP_CONTEXT)
  return JSON.stringify({ format: BACKUP_FORMAT, version: 1, kdf: 'PBKDF2-SHA256', iterations: PBKDF2_ITERATIONS, salt: toBase64(salt), data }, null, 2)
}

export function isBackup(text: string): boolean {
  try {
    return JSON.parse(text)?.format === BACKUP_FORMAT
  } catch {
    return false
  }
}

export async function decryptBackup<T>(password: string, text: string): Promise<T> {
  const file = JSON.parse(text)
  if (file?.format !== BACKUP_FORMAT || file.version !== 1) throw new Error('Este archivo no es una copia del Llavero.')
  const iterations = Number(file.iterations)
  if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 10_000_000) throw new Error('La copia está dañada.')
  const key = await backupKey(password, fromBase64(file.salt), iterations)
  let bytes: Uint8Array
  try {
    bytes = await open(key, file.data, BACKUP_CONTEXT)
  } catch {
    throw new Error('Contraseña de la copia incorrecta, o el archivo está dañado.')
  }
  return JSON.parse(dec.decode(bytes)) as T
}
