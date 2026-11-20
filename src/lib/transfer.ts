// Importar y exportar: CSV de otros gestores (Chrome, Apple, Bitwarden, 1Password, LastPass, Firefox)
// y la copia de seguridad cifrada del propio Llavero.
import { decryptBackup, encryptBackup } from './crypto'
import { parseTotp } from './totp'
import { hostOf } from './url'
import type { ItemData } from './vault'

/** CSV según RFC 4180: comillas, comas y saltos de línea dentro de un campo. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((f) => f.trim()))
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) || /^\s|\s$/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value
}

// Nombres de columna de cada gestor (en minúsculas, sin espacios ni guiones bajos).
const COLUMNS: Record<keyof ItemData, string[]> = {
  title: ['title', 'name', 'nombre', 'titulo', 'título'],
  url: ['url', 'loginuri', 'website', 'sitioweb', 'web', 'origin'],
  username: ['username', 'loginusername', 'login', 'user', 'usuario', 'email'],
  password: ['password', 'loginpassword', 'contraseña', 'contrasena'],
  totp: ['otpauth', 'totp', 'logintotp', 'otp', 'onetimepassword'],
  notes: ['notes', 'note', 'notas', 'extra', 'comments'],
  tags: ['tags', 'folder', 'grouping', 'etiquetas', 'carpeta'],
}

const norm = (h: string) => h.trim().toLowerCase().replace(/[\s_-]/g, '')

export interface ParsedImport {
  items: ItemData[]
  /** Filas sin usuario, contraseña ni código 2FA (p. ej. notas seguras o tarjetas). */
  skipped: number
}

export function importCsv(text: string): ParsedImport {
  const [header, ...rows] = parseCsv(text)
  const index = new Map((header ?? []).map((h, i) => [norm(h), i]))
  const col = Object.fromEntries(
    Object.entries(COLUMNS).map(([key, names]) => [key, names.map((n) => index.get(norm(n))).find((i) => i !== undefined)]),
  ) as Record<keyof ItemData, number | undefined>
  if (col.password === undefined) {
    throw new Error('No reconozco este archivo: le falta la columna de contraseñas. Exporta en CSV desde tu gestor.')
  }

  const items: ItemData[] = []
  let skipped = 0
  for (const row of rows) {
    const get = (key: keyof ItemData) => (col[key] === undefined ? '' : (row[col[key]!] ?? '').trim())
    const item = normalizeItem({
      title: get('title'),
      url: get('url'),
      username: get('username'),
      password: row[col.password] ?? '',
      totp: get('totp'),
      notes: get('notes'),
      tags: get('tags').split(/[,;]/),
    })
    if (item) items.push(item)
    else skipped++
  }
  return { items, skipped }
}

/** Limpia una entrada venga de donde venga; null si no tiene nada que guardar. */
export function normalizeItem(raw: Partial<Record<keyof ItemData, unknown>>): ItemData | null {
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const url = str(raw.url).trim()
  const username = str(raw.username).trim()
  const password = str(raw.password)
  let totp = str(raw.totp).trim()
  let notes = str(raw.notes).trim()
  if (!username && !password && !totp) return null

  if (totp) {
    try {
      parseTotp(totp)
    } catch {
      // Se conserva en las notas para no perderlo.
      notes = [notes, 'Código 2FA (no reconocido): ' + totp].filter(Boolean).join('\n\n')
      totp = ''
    }
  }
  const tags = Array.isArray(raw.tags) ? [...new Set(raw.tags.map(str).map((t) => t.trim()).filter(Boolean))] : []
  const title = str(raw.title).trim() || hostOf(url) || username || 'Sin título'
  return { title, url, username, password, totp, notes, tags }
}

/** Mismo sitio, usuario y contraseña: se considera repetida. */
export function itemKey(item: Pick<ItemData, 'url' | 'title' | 'username' | 'password'>): string {
  return [hostOf(item.url) || item.title.trim().toLowerCase(), item.username.trim().toLowerCase(), item.password].join('\u0000')
}

/** Quita las repetidas, tanto dentro del archivo como las que ya están en el llavero. */
export function withoutDuplicates(incoming: ItemData[], existing: ItemData[]): { fresh: ItemData[]; duplicates: number } {
  const seen = new Set(existing.map(itemKey))
  const fresh = incoming.filter((i) => {
    const key = itemKey(i)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return { fresh, duplicates: incoming.length - fresh.length }
}

/** Columnas que entienden Apple, Bitwarden, 1Password y el propio Llavero. */
export function exportCsv(items: ItemData[]): string {
  const header = ['Title', 'URL', 'Username', 'Password', 'Notes', 'OTPAuth', 'Tags']
  const lines = items.map((i) => [i.title, i.url, i.username, i.password, i.notes, i.totp, i.tags.join(', ')].map(csvField).join(','))
  return [header.join(','), ...lines].join('\r\n') + '\r\n'
}

export function exportBackup(items: ItemData[], password: string): Promise<string> {
  return encryptBackup(password, { exportedAt: new Date().toISOString(), items })
}

export async function importBackup(text: string, password: string): Promise<ParsedImport> {
  const content = await decryptBackup<{ items?: unknown }>(password, text)
  if (!Array.isArray(content.items)) throw new Error('La copia está dañada.')
  const items = content.items.map((i) => (i && typeof i === 'object' ? normalizeItem(i) : null))
  return { items: items.filter((i): i is ItemData => i !== null), skipped: items.filter((i) => !i).length }
}

/** Solo los datos de la entrada (sin id ni fecha), para exportar. */
export function dataOf(item: ItemData): ItemData {
  const { title, url, username, password, totp, notes, tags } = item
  return { title, url, username, password, totp, notes, tags }
}
