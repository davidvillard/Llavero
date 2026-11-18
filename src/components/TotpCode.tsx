import { useEffect, useMemo, useState } from 'react'
import { parseTotp, secondsLeft, totpCode } from '../lib/totp'

/** Código 2FA en vivo con cuenta atrás. */
export default function TotpCode({ secret, onCopy }: { secret: string; onCopy: (code: string) => void }) {
  const cfg = useMemo(() => {
    try {
      return parseTotp(secret)
    } catch {
      return null
    }
  }, [secret])
  const [code, setCode] = useState('')
  const [left, setLeft] = useState(0)

  useEffect(() => {
    if (!cfg) return
    let alive = true
    const tick = () => {
      setLeft(secondsLeft(cfg))
      totpCode(cfg).then((c) => alive && setCode(c))
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [cfg])

  if (!cfg) return <span className="muted">Secreto 2FA no válido</span>

  const pretty = code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code
  const pct = left / cfg.period
  return (
    <button type="button" className="totp" onClick={() => onCopy(code)} title="Copiar código">
      <span className="totp-code">{pretty}</span>
      <svg className={`totp-ring${left <= 5 ? ' urgent' : ''}`} viewBox="0 0 36 36" aria-label={`${left} segundos`}>
        <circle cx="18" cy="18" r="15" className="track" />
        <circle cx="18" cy="18" r="15" className="fill" strokeDasharray={`${pct * 94.25} 94.25`} />
        <text x="18" y="22.5" textAnchor="middle">
          {left}
        </text>
      </svg>
    </button>
  )
}
