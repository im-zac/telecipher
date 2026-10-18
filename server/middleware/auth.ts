import { isAuthorized } from '../utils/authz'

const PUBLIC_PREFIXES = ['/_nuxt', '/__nuxt', '/favicon', '/apple-touch-icon', '/icon-']
const PUBLIC_EXACT = new Set(['/login', '/api/login', '/sw.js', '/manifest.webmanifest'])

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname
  if (PUBLIC_EXACT.has(path) || PUBLIC_PREFIXES.some((p) => path.startsWith(p))) return

  const configured = useRuntimeConfig().telecipherToken
  // skill 從 loopback 用 header；瀏覽器用 cookie。兩者同一把 token。
  const header = getHeader(event, 'x-telecipher-token')
  const cookie = getCookie(event, 'telecipher_token')
  if (isAuthorized(header, configured) || isAuthorized(cookie, configured)) return

  if (path.startsWith('/api')) throw createError({ statusCode: 401, statusMessage: 'unauthorized' })
  return sendRedirect(event, '/login')
})
