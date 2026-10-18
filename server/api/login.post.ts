import { isAuthorized } from '../utils/authz'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ token?: string }>(event).catch(() => ({} as { token?: string }))
  if (!isAuthorized(body.token, useRuntimeConfig().telecipherToken)) {
    throw createError({ statusCode: 401, statusMessage: 'invalid token' })
  }
  setCookie(event, 'telecipher_token', body.token!, {
    httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 60 * 60 * 24 * 365,
  })
  return { ok: true }
})
