// Generador de contraseñas con aleatoriedad criptográfica (sin sesgo de módulo).

export interface GeneratorOptions {
  length: number
  upper: boolean
  lower: boolean
  digits: boolean
  symbols: boolean
}

export const DEFAULT_OPTIONS: GeneratorOptions = { length: 20, upper: true, lower: true, digits: true, symbols: true }

// Sin caracteres que se confunden (0/O, 1/l/I).
const SETS = {
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  lower: 'abcdefghijkmnopqrstuvwxyz',
  digits: '23456789',
  symbols: '!@#$%&*+-=?_.:',
} as const

function randomIndex(max: number): number {
  const limit = Math.floor(0x1_0000_0000 / max) * max
  const buf = new Uint32Array(1)
  do crypto.getRandomValues(buf)
  while (buf[0] >= limit)
  return buf[0] % max
}

export function generatePassword(opts: GeneratorOptions): string {
  const sets = (Object.keys(SETS) as (keyof typeof SETS)[]).filter((k) => opts[k]).map((k) => SETS[k])
  if (sets.length === 0) throw new Error('Elige al menos un tipo de carácter')
  const length = Math.min(128, Math.max(sets.length, Math.floor(opts.length)))
  const all = sets.join('')
  // Un carácter de cada tipo elegido, el resto de cualquiera, y luego se baraja.
  const chars = sets.map((s) => s[randomIndex(s.length)])
  while (chars.length < length) chars.push(all[randomIndex(all.length)])
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

/** Estimación simple de fuerza por entropía: 0 = débil … 3 = muy fuerte. */
export function strength(password: string): 0 | 1 | 2 | 3 {
  let pool = 0
  if (/[a-z]/.test(password)) pool += 26
  if (/[A-Z]/.test(password)) pool += 26
  if (/[0-9]/.test(password)) pool += 10
  if (/[^a-zA-Z0-9]/.test(password)) pool += 32
  const bits = password.length * Math.log2(pool || 1)
  return bits < 45 ? 0 : bits < 65 ? 1 : bits < 90 ? 2 : 3
}
