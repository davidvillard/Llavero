// Utilidades de direcciones web compartidas por la web y la extensión.

/** Interpreta lo que escribió el usuario ("github.com", "https://...") como URL. */
function parse(url: string): URL | null {
  const raw = url.trim()
  if (!raw) return null
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : 'https://' + raw)
  } catch {
    return null
  }
}

/** Solo enlaces http(s): evita que una URL guardada ejecute código (javascript:...). */
export function safeHref(url: string): string | null {
  const u = parse(url)
  return u && (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : null
}

/** Dominio sin "www.", o "" si no es una web. */
export function hostOf(url: string): string {
  const href = safeHref(url)
  return href ? new URL(href).hostname.toLowerCase().replace(/^www\./, '') : ''
}

/**
 * ¿La entrada guardada para `itemUrl` sirve en una página con este dominio?
 * Vale el mismo dominio o un subdominio suyo (github.com → gist.github.com), nunca al revés.
 */
export function hostMatches(itemUrl: string, pageHost: string): boolean {
  const item = hostOf(itemUrl)
  const page = pageHost.toLowerCase().replace(/^www\./, '')
  return Boolean(item) && (page === item || page.endsWith('.' + item))
}
