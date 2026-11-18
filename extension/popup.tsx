import { StrictMode, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { CopyIcon, DiceIcon, KeyIcon, LockIcon, SearchIcon } from '../src/components/icons'
import { Avatar } from '../src/components/ItemDetail'
import TotpCode from '../src/components/TotpCode'
import { DEFAULT_OPTIONS, generatePassword } from '../src/lib/generator'
import { hostMatches, hostOf } from '../src/lib/url'
import { loadItems, openVault, saveItem, type Item, type ItemData, type OpenVault } from '../src/lib/vault'
import { fillLogin, fillNewPassword, type FillResult, type NewPasswordResult } from './fill'
import { clearSession, lastEmail, restoreSession, saveSession, touchSession } from './session'
import { fingerprint, getNeverSave, keys, PENDING_TTL, sessionGet, setNeverSave, siteHost, type PendingLogin } from './shared'
import '../src/styles.css'
import './popup.css'

interface Tab {
  id: number
  /** Dominio sin "www." */
  host: string
}

async function currentTab(): Promise<Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id || !tab.url) return null
  try {
    const url = new URL(tab.url)
    return url.protocol === 'https:' || url.protocol === 'http:' ? { id: tab.id, host: siteHost(url.hostname) } : null
  } catch {
    return null
  }
}

async function currentPending(tab: Tab | null): Promise<PendingLogin | null> {
  if (!tab) return null
  const p = await sessionGet<PendingLogin>(keys.pending(tab.id))
  return p && p.host === tab.host && Date.now() - p.at < PENDING_TTL ? p : null
}

async function resolvePending(tab: Tab) {
  await chrome.storage.session.remove(keys.pending(tab.id))
  await chrome.action.setBadgeText({ tabId: tab.id, text: '' })
}

function dataOf(item: Item): ItemData {
  const { title, url, username, password, totp, notes, tags } = item
  return { title, url, username, password, totp, notes, tags }
}

function Popup() {
  const [vault, setVault] = useState<OpenVault | null | undefined>(undefined)
  const [tab, setTab] = useState<Tab | null>(null)
  const [pending, setPending] = useState<PendingLogin | null>(null)

  useEffect(() => {
    currentTab().then(async (t) => {
      setTab(t)
      setPending(await currentPending(t))
    })
    restoreSession()
      .then(setVault)
      .catch(() => setVault(null))
  }, [])

  if (vault === undefined) return null
  if (!vault) {
    return (
      <Unlock
        hint={pending ? `Desbloquea para guardar la contraseña de ${pending.host}.` : ''}
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
      pending={pending}
      onPendingDone={async () => {
        if (tab) await resolvePending(tab)
        setPending(null)
      }}
      onLock={async () => {
        await clearSession()
        setVault(null)
      }}
    />
  )
}

function Unlock({ hint, onOpen }: { hint: string; onOpen: (v: OpenVault) => Promise<void> }) {
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
      {hint && <p className="alert info">{hint}</p>}
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

type Offer = { kind: 'new' } | { kind: 'update' | 'username'; item: Item }

function VaultList(props: { vault: OpenVault; tab: Tab | null; pending: PendingLogin | null; onPendingDone: () => Promise<void>; onLock: () => void }) {
  const { vault, tab, pending, onPendingDone, onLock } = props
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState('')
  const [never, setNever] = useState(false)
  const toastTimer = useRef(0)

  useEffect(() => {
    loadItems(vault)
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.message ?? 'No se pudieron cargar tus contraseñas.'))
  }, [vault])

  useEffect(() => {
    if (tab) getNeverSave().then((list) => setNever(list.includes(tab.host)))
  }, [tab])

  const sorted = useMemo(() => [...(items ?? [])].sort((a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' })), [items])
  const forSite = useMemo(() => (tab ? sorted.filter((i) => hostMatches(i.url, tab.host)) : []), [sorted, tab])
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return sorted.filter((i) => [i.title, i.url, i.username, ...i.tags].some((f) => f.toLowerCase().includes(q)))
  }, [sorted, query])

  // ¿Qué hacer con el login detectado? Nada si ya está igual, actualizar si cambió, o guardar nuevo.
  const offer = useMemo<Offer | 'none' | null>(() => {
    if (!pending || !items) return null
    const sameSite = items.filter((i) => hostMatches(i.url, pending.host))
    const sameUser = sameSite.find((i) => i.username.toLowerCase() === pending.username.toLowerCase())
    if (sameUser) return sameUser.password === pending.password ? 'none' : { kind: 'update', item: sameUser }
    // Contraseña sugerida antes de escribir el usuario: se completa esa entrada.
    const suggested = sameSite.find((i) => !i.username && i.password === pending.password)
    if (suggested) return { kind: 'username', item: suggested }
    return { kind: 'new' }
  }, [pending, items])

  useEffect(() => {
    if (offer === 'none') void onPendingDone()
  }, [offer, onPendingDone])

  function notify(msg: string) {
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 1800)
  }

  async function store(id: string, data: ItemData): Promise<Item> {
    const saved = await saveItem(vault, id, data)
    setItems((prev) => [...(prev ?? []).filter((i) => i.id !== saved.id), saved])
    return saved
  }

  async function savePending() {
    if (!pending || !offer || offer === 'none') return
    touchSession()
    try {
      if (offer.kind !== 'new') {
        const data = dataOf(offer.item)
        await store(offer.item.id, { ...data, username: data.username || pending.username, password: pending.password })
        notify(offer.kind === 'update' ? 'Contraseña actualizada' : 'Usuario guardado')
      } else {
        await store(crypto.randomUUID(), { title: pending.host, url: pending.host, username: pending.username, password: pending.password, totp: '', notes: '', tags: [] })
        notify('Guardada en tu llavero')
      }
      await onPendingDone()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'No se pudo guardar')
    }
  }

  async function neverForSite() {
    if (!pending) return
    await setNeverSave(pending.host, true)
    setNever(true)
    await onPendingDone()
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

  async function markFilled(username: string, password: string) {
    if (tab) await chrome.storage.session.set({ [keys.filled(tab.id)]: await fingerprint(tab.host, username, password) })
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
      if (result?.ok) {
        await markFilled(item.username, item.password)
        return window.close()
      }
      notify(result?.reason === 'wrong-site' ? 'La pestaña ya no es esta web' : 'No hay campos de login en esta página')
    } catch {
      notify('Esta página no permite rellenar')
    }
  }

  async function suggest() {
    if (!tab) return
    touchSession()
    const password = generatePassword(DEFAULT_OPTIONS)
    try {
      const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: fillNewPassword, args: [password, tab.host] })
      const result = res?.result as NewPasswordResult | undefined
      if (!result?.ok) return notify('No hay campos de contraseña nueva en esta página')
      // Se guarda ya, para no perderla aunque el registro no se llegue a detectar.
      const username = result.username ?? ''
      await store(crypto.randomUUID(), { title: tab.host, url: tab.host, username, password, totp: '', notes: '', tags: [] })
      await markFilled(username, password)
      notify('Contraseña segura creada y guardada')
    } catch (e) {
      notify(e instanceof Error && e.message ? e.message : 'Esta página no permite rellenar')
    }
  }

  const list = query.trim() ? results : forSite

  return (
    <div className="pop">
      <header className="pop-head">
        <div className="search">
          <SearchIcon />
          <input type="search" placeholder="Buscar en el llavero" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus={!pending} aria-label="Buscar" />
        </div>
        <button className="icon-btn" onClick={onLock} title="Bloquear" aria-label="Bloquear">
          <LockIcon />
        </button>
      </header>

      {pending && offer && offer !== 'none' && (
        <section className="save-card" aria-label="Guardar contraseña">
          <p className="save-title">
            {offer.kind === 'update'
              ? `¿Actualizar la contraseña de ${pending.host}?`
              : offer.kind === 'username'
                ? `¿Añadir el usuario a tu contraseña de ${pending.host}?`
                : `¿Guardar la contraseña de ${pending.host}?`}
          </p>
          <p className="save-sub">
            {pending.username || 'Sin usuario'} · <span className="mono">{'•'.repeat(Math.min(12, pending.password.length))}</span>
          </p>
          <div className="save-actions">
            <button className="btn primary small" onClick={savePending}>
              {offer.kind === 'update' ? 'Actualizar' : 'Guardar'}
            </button>
            <button className="btn small" onClick={() => void onPendingDone()}>
              Ahora no
            </button>
            {offer.kind === 'new' && (
              <button className="btn link small" onClick={neverForSite}>
                Nunca en esta web
              </button>
            )}
          </div>
        </section>
      )}

      <p className="pop-section">{query.trim() ? 'Resultados' : tab ? `Para ${tab.host}` : 'Esta pestaña no es una web'}</p>

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

      {tab && !query.trim() && (
        <div className="pop-tools">
          <button className="btn ghost small" onClick={suggest} title="Para formularios de registro o de cambio de contraseña">
            <DiceIcon /> Sugerir contraseña segura
          </button>
          {never && (
            <button
              className="btn link small"
              onClick={async () => {
                await setNeverSave(tab.host, false)
                setNever(false)
              }}
            >
              Volver a ofrecer guardar en esta web
            </button>
          )}
        </div>
      )}

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
