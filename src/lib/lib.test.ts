import { describe, expect, it } from 'vitest'
import { createVaultKey, decryptJson, deriveMasterKeys, encryptJson, unwrapVaultKey } from './crypto'
import { generatePassword } from './generator'
import { base32Decode, parseTotp, totpCode } from './totp'

describe('totp (RFC 6238)', () => {
  // Vectores oficiales del RFC 6238, secreto ASCII "12345678901234567890" (SHA-1, 8 dígitos).
  const secret = new TextEncoder().encode('12345678901234567890')
  const cfg = { secret, digits: 8, period: 30, algorithm: 'SHA-1' as const }
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1234567890, '89005924'],
    [20000000000, '65353130'],
  ])('t=%i → %s', async (t, code) => {
    expect(await totpCode(cfg, t * 1000)).toBe(code)
  })

  it('decodifica base32', () => {
    expect(new TextDecoder().decode(base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'))).toBe('12345678901234567890')
  })

  it('lee URIs otpauth', () => {
    const c = parseTotp('otpauth://totp/Ej:yo?secret=JBSWY3DPEHPK3PXP&issuer=Ej&digits=6&period=30')
    expect(c.digits).toBe(6)
    expect(c.algorithm).toBe('SHA-1')
  })

  it('rechaza secretos inválidos', () => {
    expect(() => parseTotp('no-es-base32!')).toThrow()
  })
})

describe('cifrado', () => {
  it('cifra y descifra; contraseña incorrecta o id cambiado fallan', async () => {
    const userId = 'user-1'
    const good = await deriveMasterKeys('Yo@Ejemplo.com ', 'contraseña maestra larga')
    const same = await deriveMasterKeys('yo@ejemplo.com', 'contraseña maestra larga')
    const bad = await deriveMasterKeys('yo@ejemplo.com', 'otra contraseña')
    expect(good.authPassword).toBe(same.authPassword)
    expect(good.authPassword).not.toBe(bad.authPassword)

    const { vaultKey, wrapped } = await createVaultKey(good.wrapKey, userId)
    await expect(unwrapVaultKey(bad.wrapKey, wrapped, userId)).rejects.toThrow()
    const key2 = await unwrapVaultKey(same.wrapKey, wrapped, userId)

    const sealed = await encryptJson(vaultKey, 'item-a', { password: 'secreto' })
    expect(sealed).not.toContain('secreto')
    expect(await decryptJson(key2, 'item-a', sealed)).toEqual({ password: 'secreto' })
    await expect(decryptJson(key2, 'item-b', sealed)).rejects.toThrow()
  }, 20_000)
})

describe('enlaces', () => {
  it('solo permite http(s)', async () => {
    const { safeHref } = await import('../components/ItemDetail')
    expect(safeHref('github.com')).toBe('https://github.com/')
    expect(safeHref('http://x.es/a')).toBe('http://x.es/a')
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('data:text/html,hola')).toBeNull()
    expect(safeHref('')).toBeNull()
  })
})

describe('generador', () => {
  it('respeta longitud y tipos', () => {
    for (let i = 0; i < 200; i++) {
      const p = generatePassword({ length: 12, upper: true, lower: true, digits: true, symbols: false })
      expect(p).toHaveLength(12)
      expect(p).toMatch(/[A-Z]/)
      expect(p).toMatch(/[a-z]/)
      expect(p).toMatch(/[0-9]/)
      expect(p).not.toMatch(/[^a-zA-Z0-9]/)
    }
  })

  it('exige al menos un tipo', () => {
    expect(() => generatePassword({ length: 10, upper: false, lower: false, digits: false, symbols: false })).toThrow()
  })
})
