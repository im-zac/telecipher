import type { SecretRequest } from '~/server/lib/types'

export function useRequests() {
  const all = useState<SecretRequest[]>('requests', () => [])
  const loading = useState('requests-loading', () => false)
  const error = useState('requests-error', () => '')
  const pending = computed(() => all.value.filter((r) => r.status === 'pending'))
  const done = computed(() => all.value.filter((r) => r.status !== 'pending').slice(0, 50))

  async function refresh() {
    loading.value = true; error.value = ''
    try { all.value = (await $fetch<{ requests: SecretRequest[] }>('/api/requests')).requests }
    catch (e: any) { if (e?.statusCode === 401) await navigateTo('/login'); else error.value = '載入失敗' }
    finally { loading.value = false }
  }
  async function fulfill(id: string, value: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      await $fetch(`/api/requests/${id}/fulfill`, { method: 'POST', body: { value } })
      await refresh(); return { ok: true }
    } catch (e: any) {
      const reason = e?.data?.data?.reason ?? e?.data?.statusMessage ?? (e?.statusCode === 409 ? '需求已處理' : '儲存失敗')
      return { ok: false, reason }
    }
  }
  async function clearDone() { await $fetch('/api/requests/clear-done', { method: 'POST' }); await refresh() }
  return { all, pending, done, loading, error, refresh, fulfill, clearDone }
}
