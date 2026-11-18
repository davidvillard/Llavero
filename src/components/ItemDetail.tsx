import { useState } from 'react'
import type { Item } from '../lib/vault'
import { BackIcon, CopyIcon, ExternalIcon, EyeIcon } from './icons'
import TotpCode from './TotpCode'

interface Props {
  item: Item
  onCopy: (text: string, label: string) => void
  onEdit: () => void
  onDelete: () => void
  onBack: () => void
}

/** Solo enlaces http(s): evita que una URL guardada ejecute código (javascript:...). */
export function safeHref(url: string): string | null {
  const raw = url.trim()
  if (!raw) return null
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : 'https://' + raw)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
}

export function Avatar({ title }: { title: string }) {
  const letter = (title.trim()[0] ?? '?').toUpperCase()
  let hash = 0
  for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return (
    <span className="avatar" style={{ '--hue': hash % 360 } as React.CSSProperties} aria-hidden>
      {letter}
    </span>
  )
}

export default function ItemDetail({ item, onCopy, onEdit, onDelete, onBack }: Props) {
  const [reveal, setReveal] = useState(false)
  const href = safeHref(item.url)

  return (
    <article className="detail">
      <div className="detail-bar">
        <button className="btn ghost only-mobile" onClick={onBack}>
          <BackIcon /> Volver
        </button>
        <span className="spacer" />
        <button className="btn ghost" onClick={onEdit}>
          Editar
        </button>
      </div>

      <header className="detail-head">
        <Avatar title={item.title} />
        <div>
          <h2>{item.title}</h2>
          {href && (
            <a href={href} target="_blank" rel="noopener noreferrer" className="detail-link">
              {new URL(href).host} <ExternalIcon />
            </a>
          )}
        </div>
      </header>

      <div className="group">
        {item.username && (
          <Row label="Usuario">
            <span className="value">{item.username}</span>
            <CopyBtn onClick={() => onCopy(item.username, 'Usuario')} />
          </Row>
        )}
        {item.password && (
          <Row label="Contraseña">
            <span className={`value mono${reveal ? '' : ' masked'}`}>{reveal ? item.password : '••••••••••••'}</span>
            <button className="icon-btn" onClick={() => setReveal(!reveal)} aria-label={reveal ? 'Ocultar' : 'Mostrar'} title={reveal ? 'Ocultar' : 'Mostrar'}>
              <EyeIcon off={reveal} />
            </button>
            <CopyBtn onClick={() => onCopy(item.password, 'Contraseña')} />
          </Row>
        )}
        {item.totp && (
          <Row label="Código de verificación">
            <TotpCode secret={item.totp} onCopy={(c) => onCopy(c, 'Código')} />
          </Row>
        )}
      </div>

      {item.notes && (
        <div className="group">
          <Row label="Notas">
            <p className="notes">{item.notes}</p>
          </Row>
        </div>
      )}

      {item.tags.length > 0 && (
        <div className="tags">
          {item.tags.map((t) => (
            <span key={t} className="tag">
              {t}
            </span>
          ))}
        </div>
      )}

      <p className="muted small">Modificado: {new Date(item.updatedAt).toLocaleString('es-ES')}</p>

      <button className="btn danger" onClick={onDelete}>
        Eliminar
      </button>
    </article>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="row">
      <span className="row-label">{label}</span>
      <div className="row-value">{children}</div>
    </div>
  )
}

function CopyBtn({ onClick }: { onClick: () => void }) {
  return (
    <button className="icon-btn" onClick={onClick} aria-label="Copiar" title="Copiar">
      <CopyIcon />
    </button>
  )
}
