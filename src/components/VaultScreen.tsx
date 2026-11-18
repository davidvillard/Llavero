import { useEffect, useMemo, useRef, useState } from 'react'
import { deleteItem, loadItems, saveItem, type Item, type ItemData, type OpenVault } from '../lib/vault'
import Generator from './Generator'
import { ClockIcon, DiceIcon, KeyIcon, LockIcon, PlusIcon, SearchIcon, TagIcon } from './icons'
import ItemDetail, { Avatar } from './ItemDetail'
import ItemEditor from './ItemEditor'

interface Props {
  vault: OpenVault
  onLock: () => void
  onSignOut: () => void
}

/** 'all' | 'totp' | 'tag:<nombre>' */
type Filter = string

type Pane = { kind: 'none' } | { kind: 'view'; id: string } | { kind: 'edit'; id: string | null } | { kind: 'generator' }

export default function VaultScreen({ vault, onLock, onSignOut }: Props) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [failed, setFailed] = useState(0)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [pane, setPane] = useState<Pane>({ kind: 'none' })
  const [toast, setToast] = useState('')
  const toastTimer = useRef(0)

  useEffect(() => {
    loadItems(vault)
      .then((r) => {
        setItems(r.items)
        setFailed(r.failed)
      })
      .catch((e) => setLoadError(e.message ?? 'No se pudieron cargar tus contraseñas.'))
  }, [vault])

  const tags = useMemo(() => [...new Set((items ?? []).flatMap((i) => i.tags))].sort((a, b) => a.localeCompare(b, 'es')), [items])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (items ?? [])
      .filter((i) => (filter === 'all' ? true : filter === 'totp' ? Boolean(i.totp) : i.tags.includes(filter.slice(4))))
      .filter((i) => !q || [i.title, i.url, i.username, i.notes, ...i.tags].some((f) => f.toLowerCase().includes(q)))
      .sort((a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' }))
  }, [items, query, filter])

  function notify(message: string) {
    setToast(message)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 2000)
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text)
      notify(`${label} copiado`)
    } catch {
      notify('No se pudo copiar')
    }
  }

  async function save(id: string | null, data: ItemData) {
    const saved = await saveItem(vault, id ?? crypto.randomUUID(), data)
    setItems((prev) => [...(prev ?? []).filter((i) => i.id !== saved.id), saved])
    setPane({ kind: 'view', id: saved.id })
    notify('Guardado')
  }

  async function remove(item: Item) {
    if (!confirm(`¿Eliminar "${item.title}"? No se puede deshacer.`)) return
    try {
      await deleteItem(vault, item.id)
      setItems((prev) => (prev ?? []).filter((i) => i.id !== item.id))
      setPane({ kind: 'none' })
      notify('Eliminado')
    } catch (e) {
      notify(e instanceof Error ? e.message : 'No se pudo eliminar')
    }
  }

  const selected = pane.kind === 'view' || pane.kind === 'edit' ? items?.find((i) => i.id === pane.id) : undefined
  const counts = { all: items?.length ?? 0, totp: items?.filter((i) => i.totp).length ?? 0 }

  return (
    <div className={`vault${pane.kind === 'none' ? '' : ' has-pane'}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">
            <KeyIcon />
          </span>
          Llavero
        </div>
        <nav aria-label="Filtros">
          <FilterBtn active={filter === 'all'} onClick={() => setFilter('all')} icon={<KeyIcon />} label="Todas" count={counts.all} />
          <FilterBtn active={filter === 'totp'} onClick={() => setFilter('totp')} icon={<ClockIcon />} label="Códigos 2FA" count={counts.totp} />
          {tags.length > 0 && <p className="nav-title">Etiquetas</p>}
          {tags.map((t) => (
            <FilterBtn key={t} active={filter === 'tag:' + t} onClick={() => setFilter('tag:' + t)} icon={<TagIcon />} label={t} />
          ))}
        </nav>
        <div className="sidebar-foot">
          <button className="btn ghost block" onClick={() => setPane({ kind: 'generator' })}>
            <DiceIcon /> Generador
          </button>
          <button className="btn ghost block" onClick={onLock}>
            <LockIcon /> Bloquear
          </button>
          <button className="btn link small" onClick={onSignOut} title={vault.email}>
            Cerrar sesión
          </button>
          <p className="version">v{__APP_VERSION__}</p>
        </div>
      </aside>

      <section className="list-pane">
        <div className="list-head">
          <div className="search">
            <SearchIcon />
            <input type="search" placeholder="Buscar" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar" />
          </div>
          <button className="btn primary icon-only" onClick={() => setPane({ kind: 'edit', id: null })} aria-label="Nueva contraseña" title="Nueva contraseña">
            <PlusIcon />
          </button>
        </div>

        <div className="chips only-narrow">
          <Chip active={filter === 'all'} onClick={() => setFilter('all')} label="Todas" />
          <Chip active={filter === 'totp'} onClick={() => setFilter('totp')} label="2FA" />
          {tags.map((t) => (
            <Chip key={t} active={filter === 'tag:' + t} onClick={() => setFilter('tag:' + t)} label={t} />
          ))}
          <Chip active={false} onClick={() => setPane({ kind: 'generator' })} label="Generador" />
          <Chip active={false} onClick={onLock} label="Bloquear" />
        </div>

        {failed > 0 && <p className="alert error">{failed} entrada(s) no se pudieron descifrar.</p>}
        {loadError && <p className="alert error">{loadError}</p>}
        {!items && !loadError && <p className="muted pad">Descifrando…</p>}

        {items && visible.length === 0 && (
          <div className="empty">
            {items.length === 0 ? (
              <>
                <p>Aún no tienes contraseñas guardadas.</p>
                <button className="btn primary" onClick={() => setPane({ kind: 'edit', id: null })}>
                  Añadir la primera
                </button>
              </>
            ) : (
              <p className="muted">Nada coincide con la búsqueda.</p>
            )}
          </div>
        )}

        <ul className="list">
          {visible.map((i) => (
            <li key={i.id}>
              <button className={`list-item${selected?.id === i.id ? ' active' : ''}`} onClick={() => setPane({ kind: 'view', id: i.id })}>
                <Avatar title={i.title} />
                <span className="list-text">
                  <span className="list-title">{i.title}</span>
                  <span className="list-sub">{i.username || i.url || '—'}</span>
                </span>
                {i.totp && <ClockIcon />}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="detail-pane">
        {pane.kind === 'none' && (
          <div className="empty muted">
            <KeyIcon />
            <p>Elige una entrada o crea una nueva.</p>
          </div>
        )}
        {pane.kind === 'view' && selected && (
          <ItemDetail
            item={selected}
            onCopy={copy}
            onEdit={() => setPane({ kind: 'edit', id: selected.id })}
            onDelete={() => remove(selected)}
            onBack={() => setPane({ kind: 'none' })}
          />
        )}
        {pane.kind === 'edit' && (
          <ItemEditor
            key={pane.id ?? 'new'}
            initial={selected ?? null}
            onSave={(data) => save(pane.id, data)}
            onCancel={() => setPane(pane.id ? { kind: 'view', id: pane.id } : { kind: 'none' })}
          />
        )}
        {pane.kind === 'generator' && (
          <div className="detail">
            <div className="detail-bar">
              <button className="btn ghost only-mobile" onClick={() => setPane({ kind: 'none' })}>
                Volver
              </button>
              <strong>Generador de contraseñas</strong>
            </div>
            <div className="group pad">
              <Generator onCopy={(pw) => copy(pw, 'Contraseña')} />
            </div>
          </div>
        )}
      </section>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}

function FilterBtn(props: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number }) {
  return (
    <button className={`nav-item${props.active ? ' active' : ''}`} onClick={props.onClick}>
      {props.icon}
      <span>{props.label}</span>
      {props.count !== undefined && <span className="count">{props.count}</span>}
    </button>
  )
}

function Chip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button className={`chip${active ? ' active' : ''}`} onClick={onClick}>
      {label}
    </button>
  )
}
