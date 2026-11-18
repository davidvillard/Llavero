// Se inyecta en la página con chrome.scripting.executeScript, así que debe ser autocontenida:
// no puede usar nada de fuera de esta función.

export interface FillResult {
  ok: boolean
  reason?: 'wrong-site' | 'no-fields'
}

export function fillLogin(username: string, password: string, expectedHost: string): FillResult {
  // Comprobación final en la propia página: si la pestaña cambió de web, no se rellena nada.
  const host = location.hostname.toLowerCase().replace(/^www\./, '')
  if (!expectedHost || (host !== expectedHost && !host.endsWith('.' + expectedHost))) return { ok: false, reason: 'wrong-site' }

  const visible = (el: HTMLElement) => {
    const style = getComputedStyle(el)
    return el.getClientRects().length > 0 && style.visibility !== 'hidden' && style.display !== 'none' && !el.hasAttribute('disabled')
  }

  // Asigna el valor de forma que también lo detecten React, Vue, Angular, etc.
  const setValue = (el: HTMLInputElement, value: string) => {
    el.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  const inputs = Array.from(document.querySelectorAll('input')).filter(visible)
  const passwordField = inputs.find((el) => el.type === 'password')
  const textLike = inputs.filter((el) => ['text', 'email', 'tel', ''].includes(el.type))

  let userField: HTMLInputElement | undefined
  if (passwordField) {
    // El campo de texto más cercano antes de la contraseña.
    userField = textLike.filter((el) => el.compareDocumentPosition(passwordField) & Node.DOCUMENT_POSITION_FOLLOWING).pop()
  } else {
    // Login en dos pasos (primero solo el email).
    const hint = /user|email|login|mail|account|usuario|correo/i
    userField = textLike.find((el) => el.autocomplete === 'username' || hint.test(el.name + ' ' + el.id + ' ' + el.placeholder)) ?? textLike[0]
  }

  if (!userField && !passwordField) return { ok: false, reason: 'no-fields' }
  if (userField && username) setValue(userField, username)
  if (passwordField && password) setValue(passwordField, password)
  return { ok: true }
}
