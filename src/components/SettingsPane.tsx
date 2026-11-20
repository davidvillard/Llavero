import { useState, type FormEvent } from 'react'
import { isBackup } from '../lib/crypto'
import { dataOf, exportBackup, exportCsv, importBackup, importCsv, withoutDuplicates, type ParsedImport } from '../lib/transfer'
import { changeMaster, MIN_MASTER_LENGTH, saveNewItems, verifyMaster, type Item, type ItemData, type OpenVault } from '../lib/vault'
import { StrengthMeter } from './AuthScreen'

interface Props {
  vault: OpenVault
  items: Item[]
  onImported: (saved: Item[]) => void
  onNotify: (message: string) => void
  onBack: () => void
}

const message = (err: unknown) => (err instanceof Error ? err.message : 'Algo ha fallado. Inténtalo de nuevo.')

export default function SettingsPane({ vault, items, onImported, onNotify, onBack }: Props) {
  return (
    <div className="detail">
      <div className="detail-bar">
        <button className="btn ghost only-mobile" onClick={onBack}>
          Volver
        </button>
        <strong>Ajustes</strong>
      </div>
      <ChangeMaster vault={vault} onNotify={onNotify} />
      <Import vault={vault} items={items} onImported={onImported} onNotify={onNotify} />
      <Export vault={vault} items={items} onNotify={onNotify} />
    </div>
  )
}

function ChangeMaster({ vault, onNotify }: Pick<Props, 'vault' | 'onNotify'>) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (next !== repeat) return setError('Las contraseñas nuevas no coinciden.')
    setBusy(true)
    try {
      await changeMaster(vault, current, next)
      setCurrent('')
      setNext('')
      setRepeat('')
      onNotify('Contraseña maestra cambiada')
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="group settings-section" onSubmit={submit}>
      <h2>Cambiar la contraseña maestra</h2>
      <p className="muted">
        Tus contraseñas guardadas no cambian. En tus otros dispositivos y en la extensión tendrás que entrar con la nueva.
      </p>
      <input type="text" autoComplete="username" value={vault.email} readOnly hidden />
      <label className="field">
        <span>Contraseña maestra actual</span>
        <input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
      </label>
      <label className="field">
        <span>Nueva contraseña maestra</span>
        <input type="password" autoComplete="new-password" required minLength={MIN_MASTER_LENGTH} value={next} onChange={(e) => setNext(e.target.value)} />
      </label>
      <StrengthMeter password={next} />
      <label className="field">
        <span>Repite la nueva</span>
        <input type="password" autoComplete="new-password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} />
      </label>
      <p className="muted small">Si la olvidas, nadie puede recuperar tus contraseñas. Apúntala en un sitio seguro.</p>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      <div>
        <button className="btn primary" disabled={busy}>
          {busy ? 'Cambiando…' : 'Cambiar contraseña maestra'}
        </button>
      </div>
    </form>
  )
}

type ImportState =
  | { step: 'idle' }
  | { step: 'locked'; name: string; text: string }
  | { step: 'ready'; name: string; fresh: ItemData[]; duplicates: number; skipped: number }
  | { step: 'saving'; done: number; total: number }

function Import({ vault, items, onImported, onNotify }: Omit<Props, 'onBack'>) {
  const [state, setState] = useState<ImportState>({ step: 'idle' })
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  function prepare(name: string, parsed: ParsedImport) {
    const { fresh, duplicates } = withoutDuplicates(parsed.items, items)
    setState({ step: 'ready', name, fresh, duplicates, skipped: parsed.skipped })
  }

  async function pick(file: File | undefined) {
    setError('')
    setPassword('')
    if (!file) return
    try {
      const text = await file.text()
      if (isBackup(text)) setState({ step: 'locked', name: file.name, text })
      else prepare(file.name, importCsv(text))
    } catch (err) {
      setState({ step: 'idle' })
      setError(message(err))
    }
  }

  async function unlock(e: FormEvent) {
    e.preventDefault()
    if (state.step !== 'locked') return
    setError('')
    try {
      prepare(state.name, await importBackup(state.text, password))
    } catch (err) {
      setError(message(err))
    }
  }

  async function run() {
    if (state.step !== 'ready') return
    const total = state.fresh.length
    setState({ step: 'saving', done: 0, total })
    const { saved, failed } = await saveNewItems(vault, state.fresh, (done) => setState({ step: 'saving', done, total }))
    onImported(saved)
    setState({ step: 'idle' })
    if (failed) setError(`${failed} entrada(s) no se pudieron guardar. Vuelve a importar el archivo para reintentarlo: las ya guardadas no se duplican.`)
    onNotify(`${saved.length} importada(s)`)
  }

  return (
    <section className="group settings-section">
      <h2>Importar</h2>
      <p className="muted">
        Exporta tus contraseñas en CSV desde Chrome, Apple, Bitwarden, 1Password, LastPass o Firefox, o elige una copia cifrada del
        Llavero. Las que ya tengas no se duplican.
      </p>

      {state.step !== 'saving' && (
        <label className="btn ghost file-btn">
          Elegir archivo…
          <input
            type="file"
            accept=".csv,.json,text/csv,application/json"
            onChange={(e) => {
              pick(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </label>
      )}

      {state.step === 'locked' && (
        <form className="settings-inline" onSubmit={unlock}>
          <label className="field">
            <span>Contraseña de la copia «{state.name}»</span>
            <input type="password" autoComplete="off" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <div>
            <button className="btn primary">Abrir copia</button>
          </div>
        </form>
      )}

      {state.step === 'ready' && (
        <div className="settings-inline">
          <p className="alert info">
            <strong>{state.name}</strong>: {state.fresh.length} nueva(s)
            {state.duplicates > 0 && `, ${state.duplicates} que ya tienes`}
            {state.skipped > 0 && `, ${state.skipped} sin usuario ni contraseña (se ignoran)`}.
          </p>
          <div className="save-actions">
            <button className="btn primary" disabled={!state.fresh.length} onClick={run}>
              Importar {state.fresh.length}
            </button>
            <button className="btn ghost" onClick={() => setState({ step: 'idle' })}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {state.step === 'saving' && (
        <p className="alert info" role="status">
          Cifrando y guardando… {state.done} de {state.total}
        </p>
      )}

      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function Export({ vault, items, onNotify }: Pick<Props, 'vault' | 'items' | 'onNotify'>) {
  const [kind, setKind] = useState<'backup' | 'csv'>('backup')
  const [master, setMaster] = useState('')
  const [backupPw, setBackupPw] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (kind === 'backup' && backupPw !== repeat) return setError('Las contraseñas de la copia no coinciden.')
    setBusy(true)
    try {
      await verifyMaster(vault, master)
      const data = items.map(dataOf)
      const date = new Date().toISOString().slice(0, 10)
      if (kind === 'backup') download(`llavero-${date}.json`, await exportBackup(data, backupPw), 'application/json')
      else download(`llavero-${date}.csv`, exportCsv(data), 'text/csv;charset=utf-8')
      setMaster('')
      setBackupPw('')
      setRepeat('')
      onNotify(`${data.length} contraseña(s) exportada(s)`)
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="group settings-section" onSubmit={submit}>
      <h2>Exportar</h2>
      <div className="segmented" role="radiogroup" aria-label="Tipo de exportación">
        <button type="button" role="radio" aria-checked={kind === 'backup'} className={kind === 'backup' ? 'active' : ''} onClick={() => setKind('backup')}>
          Copia cifrada
        </button>
        <button type="button" role="radio" aria-checked={kind === 'csv'} className={kind === 'csv' ? 'active' : ''} onClick={() => setKind('csv')}>
          CSV sin cifrar
        </button>
      </div>

      {kind === 'backup' ? (
        <>
          <p className="muted">
            Un archivo para guardar aparte (en un USB, en tu nube…). Se abre solo con la contraseña que elijas ahora, y se puede
            importar aquí aunque pierdas la cuenta.
          </p>
          <label className="field">
            <span>Contraseña para la copia</span>
            <input type="password" autoComplete="new-password" required minLength={MIN_MASTER_LENGTH} value={backupPw} onChange={(e) => setBackupPw(e.target.value)} />
          </label>
          <StrengthMeter password={backupPw} />
          <label className="field">
            <span>Repítela</span>
            <input type="password" autoComplete="new-password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          </label>
        </>
      ) : (
        <p className="alert error">
          Para pasar tus contraseñas a otro gestor. El archivo va <strong>sin cifrar</strong>: cualquiera que lo abra las ve todas.
          Bórralo (y vacía la papelera) en cuanto lo importes.
        </p>
      )}

      <label className="field">
        <span>Tu contraseña maestra, para confirmar</span>
        <input type="password" autoComplete="current-password" required value={master} onChange={(e) => setMaster(e.target.value)} />
      </label>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      <div>
        <button className="btn primary" disabled={busy || !items.length}>
          {busy ? 'Preparando…' : kind === 'backup' ? 'Descargar copia cifrada' : 'Descargar CSV'}
        </button>
      </div>
    </form>
  )
}
