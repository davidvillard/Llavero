// Se carga en todas las webs. Detecta cuando envías un login o un registro y avisa a la
// extensión para ofrecerte guardarlo. No lee nada más ni manda nada fuera del navegador.
//
// Sin imports a propósito: Chrome carga este archivo como script clásico.
// (La detección de campos se parece a la de fill.ts, que tampoco puede importar nada.)

;(() => {
  const USER_HINT = /user|email|login|mail|account|identifier|usuario|correo/i
  const SUBMIT_HINT = /log ?in|sign ?in|sign ?up|iniciar|entrar|acceder|continu|siguiente|next|regist|crear|create|submit|enviar|aceptar|guardar|save/i

  const visible = (el: HTMLElement) => {
    const style = getComputedStyle(el)
    return el.getClientRects().length > 0 && style.visibility !== 'hidden' && style.display !== 'none'
  }
  const isText = (el: HTMLInputElement) => ['text', 'email', 'tel', ''].includes(el.type)

  function scan(scope: ParentNode): { username: string; password: string; userLooksLikeLogin: boolean } {
    const inputs = Array.from(scope.querySelectorAll('input')).filter(visible)
    const passwords = inputs.filter((el) => el.type === 'password' && el.value)
    const values = passwords.map((el) => el.value)
    // Cambio de contraseña (actual, nueva, repetir nueva): nos quedamos con la nueva.
    const password = values.length >= 2 && values[values.length - 1] === values[values.length - 2] ? values[values.length - 1] : (values[0] ?? '')

    const texts = inputs.filter((el) => isText(el) && el.value.trim())
    const anchor = passwords[0]
    const userField = anchor
      ? texts.filter((el) => el.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING).pop()
      : texts.find((el) => el.autocomplete === 'username' || el.type === 'email' || USER_HINT.test(`${el.name} ${el.id} ${el.placeholder}`))
    return { username: userField?.value.trim() ?? '', password, userLooksLikeLogin: Boolean(userField) }
  }

  let last = ''
  function capture(scope: ParentNode) {
    const { username, password, userLooksLikeLogin } = scan(scope)
    if (!password && !(username && userLooksLikeLogin)) return
    const signature = `${username}\u0000${password}`
    if (signature === last) return
    last = signature
    try {
      chrome.runtime.sendMessage({ type: 'llavero-capture', username, password }).catch(() => {})
    } catch {
      // La extensión se recargó: este script ya no está conectado.
    }
  }

  document.addEventListener('submit', (e) => capture(e.target as HTMLFormElement), true)

  document.addEventListener(
    'click',
    (e) => {
      const target = e.target as Element | null
      const button = target?.closest?.('button, input[type=submit], input[type=button], [role=button]') as HTMLElement | null
      if (!button) return
      const isSubmit = (button as HTMLButtonElement).type === 'submit' || SUBMIT_HINT.test(`${button.textContent} ${button.getAttribute('aria-label') ?? ''} ${(button as HTMLInputElement).value ?? ''}`)
      if (isSubmit) capture(button.closest('form') ?? document)
    },
    true,
  )

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Enter' && e.target instanceof HTMLInputElement) capture(e.target.form ?? document)
    },
    true,
  )
})()
