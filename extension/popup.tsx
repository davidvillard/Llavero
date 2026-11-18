import { StrictMode, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { CopyIcon, KeyIcon, LockIcon, SearchIcon } from '../src/components/icons'
import { Avatar } from '../src/components/ItemDetail'
import TotpCode from '../src/components/TotpCode'
import { hostMatches, hostOf } from '../src/lib/url'
import { loadItems, openVault, type Item, type OpenVault } from '../src/lib/vault'
import { fillLogin, type FillResult } from './fill'
import { clearSession, lastEmail, restoreSession, saveSession, touchSession } from './session'
import '../src/styles.css'
import './popup.css'

interface Tab {
  id: number
  host: string
}

async function currentTab(): Promise<Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id || !tab.url) return null
  try {
    const url = new URL(tab.url)
    return url.protocol === 'https:' || url.protocol === 'http:' ? { id: tab.id, host: url.hostname.toLowerCase() } : null
  } catch {
    return null
  }
}

function Popup() {
  const [vault, setVault] = useState<OpenVault | null | undefined>(undefined)
  const [tab, setTab] = useState<Tab | null>(null)

  useEffect(() => {
    currentTab().then(setTab)
    restoreSession()
      .then(setVault)
      .catch(() => setVault(null))
  }, [])

  if (vault === undefined) return null
  if (!vault) {
    return (
      <Unlock
        onOpen={async (v) => {
          await saveSession(v)
          setVault(v)
        }}
      />
    )
  }
  return (
    <VaultList
      vault={vault}
      tab={tab}
      onLock={async () => {
        await clearSession()
        setVault(null)
      }}
    />
  )
}

function Unlock({ onOpen }: { onOpen: (v: OpenVault) => Promise<void> }) {
  const [email, setEmail] = useState('')
  const [master, setMaster] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    lastEmail().then(setEmail)
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await onOpen(await openVault(email, master, true))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo desbloquear.')
      setBusy(false)
    }
  }

  return (
    <form className="pop-unlock" onSubmit={submit}>
      <div className="auth-logo">
        <KeyIcon />
      </div>
      <h1>Llavero</h1>
      <label className="field">
        <span>Email</span>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
      </label>
      <label className="field">
        <span>Contraseña maestra</span>
        <input type="password" required autoFocus value={master} onChange={(e) => setMaster(e.target.value)} autoComplete="current-password" />
      </label>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      <button className="btn primary block" disabled={busy}>
        {busy ? 'Abriendo…' : 'Desbloquear'}
      </button>
      <p className="muted small">Si aún no tienes llavero, créalo desde la web.</p>
      <p className="version">v{__APP_VERSION__}</p>
    </form>
  )
}

function VaultList({ vault, tab, onLock }: { vault: OpenVault; tab: Tab | null; onLock: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState('')
  const toastTimer = useRef(0)

  useEffect(() => {
    loadItems(vault)
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.message ?? 'No se pudieron cargar tus contraseñas.'))
  }, [vault])

  const sorted = useMemo(() => [...(items ?? [])].sort((a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' })), [items])
  const forSite = useMemo(() => (tab ? sorted.filter((i) => hostMatches(i.url, tab.host)) : []), [sorted, tab])
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return sorted.filter((i) => [i.title, i.url, i.username, ...i.tags].some((f) => f.toLowerCase().includes(q)))
  }, [sorted, query])

  function notify(msg: string) {
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 1800)
  }

  async function copy(text: string, label: string) {
    touchSession()
    try {
      await navigator.clipboard.writeText(text)
      notify(`${label} copiado`)
    } catch {
      notify('No se pudo copiar')
    }
  }

  async function fill(item: Item) {
    if (!tab) return
    touchSession()
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: fillLogin,
        args: [item.username, item.password, hostOf(item.url)],
      })
      const result = res?.result as FillResult | undefined
      if (result?.ok) return window.close()
      notify(result?.reason === 'wrong-site' ? 'La pestaña ya no es esta web' : 'No hay campos de login en esta página')
    } catch {
      notify('Esta página no permite rellenar')
    }
  }

  const list = query.trim() ? results : forSite

  return (
    <div className="pop">
      <header className="pop-head">
        <div className="search">
          <SearchIcon />
          <input type="search" placeholder="Buscar en el llavero" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus aria-label="Buscar" />
        </div>
        <button className="icon-btn" onClick={onLock} title="Bloquear" aria-label="Bloquear">
          <LockIcon />
        </button>
      </header>

      <p className="pop-section">{query.trim() ? 'Resultados' : tab ? `Para ${tab.host.replace(/^www\./, '')}` : 'Esta pestaña no es una web'}</p>

      {error && <p className="alert error">{error}</p>}
      {!items && !error && <p className="muted pad">Descifrando…</p>}
      {items && list.length === 0 && (
        <p className="muted pad">{query.trim() ? 'Nada coincide.' : 'No tienes nada guardado para esta web. Usa el buscador.'}</p>
      )}

      <ul className="pop-list">
        {list.map((i) => {
          const canFill = Boolean(tab && hostMatches(i.url, tab.host))
          return (
            <li key={i.id} className="pop-item">
              <div className="pop-item-main">
                <Avatar title={i.title} />
                <span className="list-text">
                  <span className="list-title">{i.title}</span>
                  <span className="list-sub">{i.username || hostOf(i.url) || '—'}</span>
                </span>
                {canFill && (
                  <button className="btn primary small" onClick={() => fill(i)}>
                    Rellenar
                  </button>
                )}
              </div>
              <div className="pop-actions">
                {i.username && (
                  <button className="chip" onClick={() => copy(i.username, 'Usuario')}>
                    <CopyIcon /> Usuario
                  </button>
                )}
                {i.password && (
                  <button className="chip" onClick={() => copy(i.password, 'Contraseña')}>
                    <CopyIcon /> Contraseña
                  </button>
                )}
                {i.totp && <TotpCode secret={i.totp} onCopy={(c) => copy(c, 'Código')} />}
              </div>
            </li>
          )
        })}
      </ul>

      <footer className="pop-foot">
        <span className="muted small">{vault.email}</span>
        <span className="version">v{__APP_VERSION__}</span>
      </footer>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
)
