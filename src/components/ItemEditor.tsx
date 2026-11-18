import { useState, type FormEvent } from 'react'
import { strength } from '../lib/generator'
import { parseTotp } from '../lib/totp'
import type { ItemData } from '../lib/vault'
import Generator from './Generator'
import { DiceIcon, EyeIcon } from './icons'

interface Props {
  initial: ItemData | null
  onSave: (data: ItemData) => Promise<void>
  onCancel: () => void
}

const EMPTY: ItemData = { title: '', url: '', username: '', password: '', totp: '', notes: '', tags: [] }
const STRENGTH_LABELS = ['Débil', 'Aceptable', 'Fuerte', 'Muy fuerte']

function hostOf(url: string): string {
  try {
    return new URL(/^[a-z]+:/i.test(url) ? url : 'https://' + url).host.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export default function ItemEditor({ initial, onSave, onCancel }: Props) {
  const start = initial ?? EMPTY
  const [form, setForm] = useState({ ...start, tagsText: start.tags.join(', ') })
  const [baseline] = useState(() => JSON.stringify(toData(form)))
  const [reveal, setReveal] = useState(!initial)
  const [showGen, setShowGen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value })

  function toData(f = form): ItemData {
    const tags = [...new Set(f.tagsText.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))]
    return {
      title: f.title.trim() || hostOf(f.url) || f.username.trim(),
      url: f.url.trim(),
      username: f.username.trim(),
      password: f.password,
      totp: f.totp.trim(),
      notes: f.notes,
      tags,
    }
  }

  const dirty = JSON.stringify(toData()) !== baseline

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    const data = toData()
    if (!data.title) return setError('Pon al menos un nombre, una web o un usuario.')
    if (data.totp) {
      try {
        parseTotp(data.totp)
      } catch (err) {
        return setError('Código 2FA: ' + (err as Error).message)
      }
    }
    setBusy(true)
    try {
      await onSave(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar.')
      setBusy(false)
    }
  }

  function cancel() {
    if (!dirty || confirm('¿Descartar los cambios?')) onCancel()
  }

  return (
    <form className="detail editor" onSubmit={submit}>
      <div className="detail-bar">
        <button type="button" className="btn ghost" onClick={cancel}>
          Cancelar
        </button>
        <span className="spacer" />
        <strong>{initial ? 'Editar' : 'Nueva contraseña'}</strong>
        <span className="spacer" />
        <button className="btn primary" disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
      </div>

      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}

      <label className="field">
        <span>Nombre</span>
        <input value={form.title} onChange={set('title')} placeholder="Ej. Gmail" autoFocus={!initial} />
      </label>
      <label className="field">
        <span>Web</span>
        <input value={form.url} onChange={set('url')} placeholder="ejemplo.com" inputMode="url" autoComplete="off" />
      </label>
      <label className="field">
        <span>Usuario o email</span>
        <input value={form.username} onChange={set('username')} autoComplete="off" />
      </label>

      <div className="field">
        <label htmlFor="pw">Contraseña</label>
        <div className="input-row">
          <input
            id="pw"
            className="mono"
            type={reveal ? 'text' : 'password'}
            value={form.password}
            onChange={set('password')}
            autoComplete="new-password"
          />
          <button type="button" className="icon-btn" onClick={() => setReveal(!reveal)} aria-label={reveal ? 'Ocultar' : 'Mostrar'}>
            <EyeIcon off={reveal} />
          </button>
          <button type="button" className="icon-btn" onClick={() => setShowGen(!showGen)} aria-label="Generar contraseña" title="Generar">
            <DiceIcon />
          </button>
        </div>
        {form.password && (
          <div className={`strength s${strength(form.password)}`}>
            <div className="strength-bar">
              <i />
            </div>
            <span>{STRENGTH_LABELS[strength(form.password)]}</span>
          </div>
        )}
      </div>

      {showGen && (
        <div className="group pad">
          <Generator
            onUse={(pw) => {
              setForm({ ...form, password: pw })
              setReveal(true)
              setShowGen(false)
            }}
          />
        </div>
      )}

      <label className="field">
        <span>Código 2FA (opcional)</span>
        <input
          className="mono"
          value={form.totp}
          onChange={set('totp')}
          placeholder="Clave secreta o enlace otpauth://"
          autoComplete="off"
          spellCheck={false}
        />
        <small className="muted">Es la "clave de configuración" que da la web al activar la verificación en dos pasos.</small>
      </label>

      <label className="field">
        <span>Etiquetas</span>
        <input value={form.tagsText} onChange={set('tagsText')} placeholder="trabajo, banco, redes" />
      </label>

      <label className="field">
        <span>Notas</span>
        <textarea rows={4} value={form.notes} onChange={set('notes')} />
      </label>
    </form>
  )
}
