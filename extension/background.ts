// Proceso de fondo: recibe los logins detectados, los guarda como pendientes (en memoria)
// y abre el popup para ofrecer guardarlos. No tiene acceso al llavero ni a Firebase.
import { fingerprint, getNeverSave, keys, sessionGet, siteHost, USER_TTL, type PendingLogin, type PendingUser } from './shared'

const PROMPT_WAIT_MS = 4000

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'llavero-capture') void handleCapture(msg, sender)
})

chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.remove([keys.pending(tabId), keys.user(tabId), keys.filled(tabId)])
})

async function handleCapture(msg: { username?: unknown; password?: unknown }, sender: chrome.runtime.MessageSender) {
  // Solo la página principal de una pestaña, y el dominio lo da Chrome, no el mensaje.
  const tabId = sender.tab?.id
  if (tabId === undefined || sender.frameId !== 0 || !sender.url) return
  const url = new URL(sender.url)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return
  const host = siteHost(url.hostname)
  const username = String(msg.username ?? '').slice(0, 300)
  const password = String(msg.password ?? '').slice(0, 300)

  if (!password) {
    if (username) await chrome.storage.session.set({ [keys.user(tabId)]: { host, username, at: Date.now() } satisfies PendingUser })
    return
  }
  if ((await getNeverSave()).includes(host)) return

  let user = username
  if (!user) {
    const prev = await sessionGet<PendingUser>(keys.user(tabId))
    if (prev && prev.host === host && Date.now() - prev.at < USER_TTL) user = prev.username
  }

  // Si lo acaba de rellenar Llavero, ya está guardado.
  const filled = await sessionGet<string>(keys.filled(tabId))
  if (filled && filled === (await fingerprint(host, user, password))) return

  await chrome.storage.session.set({ [keys.pending(tabId)]: { host, username: user, password, at: Date.now() } satisfies PendingLogin })
  promptWhenLoaded(tabId)
}

/** Espera a que cargue la página siguiente al login y abre el popup (o deja un aviso en el icono). */
function promptWhenLoaded(tabId: number) {
  let done = false
  const finish = async () => {
    if (done) return
    done = true
    chrome.tabs.onUpdated.removeListener(onUpdated)
    clearTimeout(timer)
    try {
      if (!(await sessionGet<PendingLogin>(keys.pending(tabId)))) return
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#0a84ff' })
      await chrome.action.setBadgeText({ tabId, text: '1' })
      const tab = await chrome.tabs.get(tabId)
      if (tab.active) await chrome.action.openPopup({ windowId: tab.windowId })
    } catch {
      // Navegadores sin openPopup: queda el aviso en el icono.
    }
  }
  const onUpdated = (id: number, info: { status?: string }) => {
    if (id === tabId && info.status === 'complete') void finish()
  }
  chrome.tabs.onUpdated.addListener(onUpdated)
  const timer = setTimeout(() => void finish(), PROMPT_WAIT_MS)
}
