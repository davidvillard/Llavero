import { useState, type FormEvent } from 'react'
import { strength } from '../lib/generator'
import { MIN_MASTER_LENGTH, openVault, register, type OpenVault } from '../lib/vault'
import { KeyIcon } from './icons'

interface Props {
  /** Si hay sesión guardada, el llavero está "bloqueado" para este email. */
  lockedEmail: string | null
  onOpen: (vault: OpenVault) => void
  onUseOtherAccount: () => void
}

const STRENGTH_LABELS = ['Débil', 'Aceptable', 'Fuerte', 'Muy fuerte']

export function StrengthMeter({ password }: { password: string }) {
  if (!password) return null
  const level = strength(password)
  return (
    <div className={`strength s${level}`} aria-live="polite">
      <div className="strength-bar">
        <i />
      </div>
      <span>{STRENGTH_LABELS[level]}</span>
    </div>
  )
}

export default function AuthScreen({ lockedEmail, onOpen, onUseOtherAccount }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState(lockedEmail ?? '')
  const [master, setMaster] = useState('')
  const [confirm, setConfirm] = useState('')
  const [understood, setUnderstood] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const registering = mode === 'register'

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (registering) {
      if (master !== confirm) return setError('Las contraseñas no coinciden.')
      if (!understood) return setError('Marca la casilla para confirmar que lo entiendes.')
    }
    setBusy(true)
    try {
      onOpen(await (registering ? register(email, master) : openVault(email, master)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Algo ha fallado. Inténtalo de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="center-screen">
      <form className="card auth-card" onSubmit={submit}>
        <div className="auth-logo">
          <KeyIcon />
        </div>
        <h1>{lockedEmail ? 'Llavero bloqueado' : registering ? 'Crea tu llavero' : 'Llavero'}</h1>
        <p className="muted">
          {lockedEmail
            ? 'Escribe tu contraseña maestra para desbloquear.'
            : registering
              ? 'Tus contraseñas se cifran en este dispositivo. Nadie más puede leerlas, ni siquiera el servidor.'
              : 'Entra con tu email y tu contraseña maestra.'}
        </p>

        {!lockedEmail && (
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
        )}
        {lockedEmail && <p className="locked-email">{lockedEmail}</p>}

        <label className="field">
          <span>Contraseña maestra</span>
          <input
            type="password"
            autoComplete={registering ? 'new-password' : 'current-password'}
            required
            minLength={registering ? MIN_MASTER_LENGTH : undefined}
            autoFocus={Boolean(lockedEmail)}
            value={master}
            onChange={(e) => setMaster(e.target.value)}
          />
        </label>

        {registering && (
          <>
            <StrengthMeter password={master} />
            <label className="field">
              <span>Repite la contraseña maestra</span>
              <input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </label>
            <label className="check">
              <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
              <span>Entiendo que si olvido la contraseña maestra no hay forma de recuperar mis contraseñas.</span>
            </label>
          </>
        )}

        {error && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}

        <button className="btn primary block" disabled={busy}>
          {busy ? 'Abriendo…' : lockedEmail ? 'Desbloquear' : registering ? 'Crear llavero' : 'Entrar'}
        </button>

        {lockedEmail ? (
          <button type="button" className="btn link" onClick={onUseOtherAccount}>
            Cerrar sesión y usar otra cuenta
          </button>
        ) : (
          <button
            type="button"
            className="btn link"
            onClick={() => {
              setMode(registering ? 'login' : 'register')
              setError('')
            }}
          >
            {registering ? '¿Ya tienes cuenta? Entra' : '¿Primera vez? Crea tu llavero'}
          </button>
        )}
        <p className="version">v{__APP_VERSION__}</p>
      </form>
    </main>
  )
}
