export default defineNuxtPlugin(() => {
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('[push] SW 註冊失敗', e))
  navigator.serviceWorker.addEventListener('message', (event) => {
    const d = event.data || {}
    if (d.type === 'openRequest' && d.id) navigateTo(`/requests/${d.id}`)
  })
})
