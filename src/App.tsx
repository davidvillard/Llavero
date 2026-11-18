import { useEffect, useState } from 'react'
import AuthScreen from './components/AuthScreen'
import VaultScreen from './components/VaultScreen'
import { firebaseConfigured } from './lib/firebase'
import { currentSessionEmail, signOut, type OpenVault } from './lib/vault'

/** Se bloquea tras este tiempo sin actividad: la clave se borra de la memoria. */
const AUTO_LOCK_MS = 5 * 60 * 1000

export default function App() {
  const [vault, setVault] = useState<OpenVault | null>(null)
  const [sessionEmail, setSessionEmail] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    if (firebaseConfigured) currentSessionEmail().then(setSessionEmail)
  }, [])

  useEffect(() => {
    if (!vault) return
    let timer = window.setTimeout(lock, AUTO_LOCK_MS)
    const reset = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(lock, AUTO_LOCK_MS)
    }
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }))
    return () => {
      window.clearTimeout(timer)
      events.forEach((e) => window.removeEventListener(e, reset))
    }
  }, [vault])

  function lock() {
    setSessionEmail((e) => e ?? vault?.email ?? null)
    setVault(null)
  }

  async function logOut() {
    await signOut()
    setVault(null)
    setSessionEmail(null)
  }

  if (!firebaseConfigured) {
    return (
      <main className="center-screen">
        <div className="card auth-card">
          <h1>Falta configurar Firebase</h1>
          <p className="muted">
            Copia <code>.env.example</code> como <code>.env</code>, rellena la configuración de tu proyecto de Firebase y reinicia{' '}
            <code>npm run dev</code>. Los pasos están en el README.
          </p>
        </div>
      </main>
    )
  }

  if (sessionEmail === undefined) return null

  if (!vault) {
    return (
      <AuthScreen
        lockedEmail={sessionEmail}
        onOpen={(v) => {
          setSessionEmail(v.email)
          setVault(v)
        }}
        onUseOtherAccount={logOut}
      />
    )
  }

  return <VaultScreen vault={vault} onLock={lock} onSignOut={logOut} />
}
