import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_OPTIONS, generatePassword, type GeneratorOptions } from '../lib/generator'
import { CopyIcon, DiceIcon } from './icons'

interface Props {
  onCopy?: (password: string) => void
  /** Si se pasa, aparece el botón "Usar esta contraseña". */
  onUse?: (password: string) => void
}

const TOGGLES: [keyof Omit<GeneratorOptions, 'length'>, string][] = [
  ['upper', 'Mayúsculas'],
  ['lower', 'Minúsculas'],
  ['digits', 'Números'],
  ['symbols', 'Símbolos'],
]

export default function Generator({ onCopy, onUse }: Props) {
  const [opts, setOpts] = useState<GeneratorOptions>(DEFAULT_OPTIONS)
  const [password, setPassword] = useState('')

  const regenerate = useCallback(() => setPassword(generatePassword(opts)), [opts])
  useEffect(regenerate, [regenerate])

  function toggle(key: keyof Omit<GeneratorOptions, 'length'>) {
    const next = { ...opts, [key]: !opts[key] }
    if (TOGGLES.some(([k]) => next[k])) setOpts(next) // siempre queda al menos uno
  }

  return (
    <div className="generator">
      <div className="gen-output">
        <code>{password}</code>
        <button type="button" className="icon-btn" onClick={regenerate} title="Generar otra" aria-label="Generar otra">
          <DiceIcon />
        </button>
        {onCopy && (
          <button type="button" className="icon-btn" onClick={() => onCopy(password)} title="Copiar" aria-label="Copiar">
            <CopyIcon />
          </button>
        )}
      </div>

      <label className="field">
        <span>
          Longitud: <strong>{opts.length}</strong>
        </span>
        <input type="range" min={8} max={64} value={opts.length} onChange={(e) => setOpts({ ...opts, length: Number(e.target.value) })} />
      </label>

      <div className="toggles">
        {TOGGLES.map(([key, label]) => (
          <label key={key} className="check">
            <input type="checkbox" checked={opts[key]} onChange={() => toggle(key)} />
            <span>{label}</span>
          </label>
        ))}
      </div>

      {onUse && (
        <button type="button" className="btn primary block" onClick={() => onUse(password)}>
          Usar esta contraseña
        </button>
      )}
    </div>
  )
}
