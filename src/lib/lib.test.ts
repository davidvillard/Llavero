import { describe, expect, it } from 'vitest'
import { createVaultKey, decryptJson, deriveMasterKeys, encryptJson, isBackup, rewrapVaultKey, unwrapVaultKey } from './crypto'
import { exportBackup, exportCsv, importBackup, importCsv, parseCsv, withoutDuplicates } from './transfer'
import { generatePassword } from './generator'
import { base32Decode, parseTotp, totpCode } from './totp'
import { hostMatches, hostOf, safeHref } from './url'

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
  it('solo permite http(s)', () => {
    expect(safeHref('github.com')).toBe('https://github.com/')
    expect(safeHref('http://x.es/a')).toBe('http://x.es/a')
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('data:text/html,hola')).toBeNull()
    expect(safeHref('')).toBeNull()
  })

  it('reconoce el mismo sitio y sus subdominios, nunca al revés', () => {
    expect(hostOf('https://www.GitHub.com/login')).toBe('github.com')
    expect(hostMatches('github.com', 'github.com')).toBe(true)
    expect(hostMatches('github.com', 'www.github.com')).toBe(true)
    expect(hostMatches('github.com', 'gist.github.com')).toBe(true)
    expect(hostMatches('accounts.google.com', 'google.com')).toBe(false)
    expect(hostMatches('github.com', 'github.com.evil.io')).toBe(false)
    expect(hostMatches('github.com', 'notgithub.com')).toBe(false)
    expect(hostMatches('', 'github.com')).toBe(false)
    expect(hostMatches('javascript:alert(1)', 'alert(1)')).toBe(false)
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

describe('importar y exportar', () => {
  it('lee CSV con comillas, comas y saltos de línea', () => {
    expect(parseCsv('a,b\r\n"x, ""y""","línea 1\nlínea 2"\n')).toEqual([
      ['a', 'b'],
      ['x, "y"', 'línea 1\nlínea 2'],
    ])
  })

  it('entiende el CSV de Chrome', () => {
    const r = importCsv('name,url,username,password,note\ngithub.com,https://github.com/login,ana,s3cr3t ,nota\n')
    expect(r.items).toEqual([{ title: 'github.com', url: 'https://github.com/login', username: 'ana', password: 's3cr3t ', totp: '', notes: 'nota', tags: [] }])
  })

  it('entiende el CSV de Bitwarden (carpeta, 2FA y notas seguras)', () => {
    const csv = [
      'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp',
      'Trabajo,,login,Correo,,,0,https://mail.ejemplo.com,ana@ejemplo.com,pw1,JBSWY3DPEHPK3PXP',
      ',,note,Nota secreta,texto,,0,,,,',
      ',,login,Raro,,,0,raro.com,yo,pw2,steam://ABC',
    ].join('\n')
    const r = importCsv(csv)
    expect(r.skipped).toBe(1)
    expect(r.items[0]).toMatchObject({ title: 'Correo', tags: ['Trabajo'], totp: 'JBSWY3DPEHPK3PXP' })
    expect(r.items[1].totp).toBe('')
    expect(r.items[1].notes).toContain('steam://ABC')
  })

  it('pone el dominio como título si no hay nombre (Firefox)', () => {
    expect(importCsv('url,username,password\nhttps://www.foro.es,pepe,x').items[0].title).toBe('foro.es')
  })

  it('rechaza archivos sin contraseñas', () => {
    expect(() => importCsv('a,b\n1,2')).toThrow()
  })

  it('exporta y vuelve a importar sin perder nada', () => {
    const item = { title: 'Banco, "personal"', url: 'https://banco.es', username: 'yo', password: ' =1,2"\n3 ', totp: 'JBSWY3DPEHPK3PXP', notes: 'a\nb', tags: ['casa', 'dinero'] }
    expect(importCsv(exportCsv([item])).items).toEqual([item])
  })

  it('quita repetidas del archivo y del llavero', () => {
    const a = { title: 'A', url: 'https://www.a.com', username: 'Yo', password: 'p', totp: '', notes: '', tags: [] }
    const b = { ...a, url: 'a.com/login', username: 'yo', notes: 'otra nota' }
    const c = { ...a, password: 'otra' }
    expect(withoutDuplicates([b, c, c], [a])).toEqual({ fresh: [c], duplicates: 2 })
  })

  it('copia cifrada: abre con su contraseña y falla con otra', async () => {
    const item = { title: 'T', url: '', username: 'u', password: 'p', totp: '', notes: '', tags: ['x'] }
    const file = await exportBackup([item], 'copia-segura-123')
    expect(file).not.toContain('"p"')
    expect(isBackup(file)).toBe(true)
    expect((await importBackup(file, 'copia-segura-123')).items).toEqual([item])
    await expect(importBackup(file, 'otra-contraseña')).rejects.toThrow(/incorrecta/)
  })

  it('reenvuelve la clave del llavero con la nueva contraseña maestra', async () => {
    const before = await deriveMasterKeys('a@b.c', 'maestra-antigua')
    const after = await deriveMasterKeys('a@b.c', 'maestra-nueva-1')
    const { vaultKey, wrapped } = await createVaultKey(before.wrapKey, 'uid1')
    const sealed = await encryptJson(vaultKey, 'i1', { ok: 1 })
    const rewrapped = await rewrapVaultKey(before.wrapKey, after.wrapKey, wrapped, 'uid1')
    expect(await decryptJson(await unwrapVaultKey(after.wrapKey, rewrapped, 'uid1'), 'i1', sealed)).toEqual({ ok: 1 })
    await expect(unwrapVaultKey(before.wrapKey, rewrapped, 'uid1')).rejects.toThrow()
  }, 20000)
})
