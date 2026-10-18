// PWA 推播訂閱狀態與操作。瀏覽器 API，靠實機驗證。
export function usePush() {
  const supported = useState('push-supported', () => false)
  const permission = useState<NotificationPermission>('push-permission', () => 'default')
  const subscribed = useState('push-subscribed', () => false)

  async function refresh() {
    supported.value = import.meta.client && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
    if (!supported.value) return
    permission.value = Notification.permission
    const reg = await navigator.serviceWorker.ready
    subscribed.value = !!(await reg.pushManager.getSubscription())
  }

  async function subscribe() {
    if (!supported.value) return
    permission.value = await Notification.requestPermission()
    if (permission.value !== 'granted') return
    const { key } = await $fetch<{ key: string | null }>('/api/push/vapid-public-key')
    if (!key) { console.warn('[push] server 未設定 VAPID'); return }
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) as BufferSource })
    await $fetch('/api/push/subscribe', { method: 'POST', body: sub.toJSON() })
    subscribed.value = true
  }

  async function unsubscribe() {
    if (!supported.value) return
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      await $fetch('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {})
      await sub.unsubscribe()
    }
    subscribed.value = false
  }

  return { supported, permission, subscribed, refresh, subscribe, unsubscribe }
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}
