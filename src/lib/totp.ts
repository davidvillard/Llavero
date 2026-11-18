// Códigos 2FA TOTP (RFC 6238). Acepta un secreto en base32 o una URI otpauth://totp/...

export interface TotpConfig {
  secret: Uint8Array<ArrayBuffer>
  digits: number
  period: number
  algorithm: 'SHA-1' | 'SHA-256' | 'SHA-512'
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Decode(input: string): Uint8Array<ArrayBuffer> {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '')
  if (!clean) throw new Error('Secreto vacío')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch)
    if (idx === -1) throw new Error('El secreto no es base32 válido')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

/** Lanza un error con mensaje legible si el texto no es un secreto/URI válido. */
export function parseTotp(input: string): TotpConfig {
  const text = input.trim()
  if (!text.toLowerCase().startsWith('otpauth://')) {
    return { secret: base32Decode(text), digits: 6, period: 30, algorithm: 'SHA-1' }
  }
  const url = new URL(text)
  if (url.host.toLowerCase() !== 'totp') throw new Error('Solo se admiten códigos TOTP')
  const secret = url.searchParams.get('secret')
  if (!secret) throw new Error('La URI no tiene secreto')
  const digits = Number(url.searchParams.get('digits') ?? 6)
  const period = Number(url.searchParams.get('period') ?? 30)
  const algo = (url.searchParams.get('algorithm') ?? 'SHA1').toUpperCase()
  const algorithm = ({ SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' } as const)[algo as 'SHA1']
  if (!algorithm) throw new Error('Algoritmo no admitido: ' + algo)
  if (![6, 7, 8].includes(digits)) throw new Error('Número de dígitos no admitido')
  if (!Number.isInteger(period) || period < 1) throw new Error('Periodo no válido')
  return { secret: base32Decode(secret), digits, period, algorithm }
}

export async function totpCode(cfg: TotpConfig, timeMs = Date.now()): Promise<string> {
  const counter = Math.floor(timeMs / 1000 / cfg.period)
  const msg = new Uint8Array(8)
  new DataView(msg.buffer).setBigUint64(0, BigInt(counter))
  const key = await crypto.subtle.importKey('raw', cfg.secret, { name: 'HMAC', hash: cfg.algorithm }, false, ['sign'])
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg))
  const off = h[h.length - 1] & 0x0f
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3]
  return String(bin % 10 ** cfg.digits).padStart(cfg.digits, '0')
}

export function secondsLeft(cfg: TotpConfig, timeMs = Date.now()): number {
  return cfg.period - (Math.floor(timeMs / 1000) % cfg.period)
}
