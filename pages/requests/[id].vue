<script setup lang="ts">
import type { SecretRequest } from '~/server/lib/types'
import { relativeTime } from '~/utils/time'
const route = useRoute()
const id = String(route.params.id)
const { fulfill } = useRequests()
const r = ref<SecretRequest | null>(null)
const notFound = ref(false)
const value = ref('')
const saving = ref(false)
const msg = ref<{ kind: 'ok' | 'err'; text: string } | null>(null)

async function load() {
  try { r.value = await $fetch<SecretRequest>(`/api/requests/${id}`) }
  catch (e: any) { if (e?.statusCode === 401) await navigateTo('/login'); else notFound.value = true }
}
onMounted(load)

async function save() {
  if (!value.value || saving.value) return
  saving.value = true; msg.value = null
  const res = await fulfill(id, value.value)
  saving.value = false
  if (res.ok) { value.value = ''; msg.value = { kind: 'ok', text: `已寫入 ${r.value?.path}` }; await load() }
  else msg.value = { kind: 'err', text: res.reason }
}
const label: Record<string, string> = { pending: '待處理', fulfilled: '已寫入', cancelled: '已取消' }
</script>
<template>
  <main class="wrap">
    <header style="display:flex;justify-content:space-between;align-items:center">
      <NuxtLink to="/" class="brand">tele<b>cipher</b></NuxtLink>
      <BellButton />
    </header>
    <div v-if="notFound" class="err" style="margin-top:20px">找不到這筆需求。</div>
    <template v-else-if="r">
      <h2>需求 <span class="mono faint">{{ r.id }}</span></h2>
      <section class="card">
        <dl class="dl">
          <dt>Session</dt><dd style="font-weight:600">{{ r.session }}</dd>
          <dt>寫入位置</dt><dd class="mono">{{ r.path }}</dd>
          <dt>模式</dt><dd class="mono">{{ r.mode === 'env' ? `env · ${r.key}` : 'file（整檔）' }}</dd>
          <dt>說明</dt><dd>{{ r.description }}</dd>
          <dt>建立</dt><dd class="muted">{{ relativeTime(r.createdAt) }}</dd>
          <dt>狀態</dt><dd><span class="badge" :class="r.status">{{ label[r.status] }}</span>
            <span v-if="r.fulfilledAt" class="faint"> · {{ relativeTime(r.fulfilledAt) }}</span></dd>
        </dl>
      </section>

      <form v-if="r.status === 'pending'" class="card" style="margin-top:14px" @submit.prevent="save">
        <label for="v" class="muted" style="display:block;margin-bottom:6px">貼上值（原樣寫入，不會 trim）</label>
        <textarea id="v" v-model="value" rows="4" autocomplete="off" autocapitalize="off" spellcheck="false" style="width:100%" :disabled="saving" />
        <div style="display:flex;gap:10px;align-items:center;margin-top:10px">
          <button type="submit" class="btn primary" :disabled="!value || saving">{{ saving ? '寫入中…' : '儲存' }}</button>
          <span v-if="msg" :class="msg.kind">{{ msg.text }}</span>
        </div>
      </form>
      <div v-else-if="msg" :class="msg.kind" style="margin-top:14px">{{ msg.text }}</div>
    </template>
  </main>
</template>
<style scoped>
.dl { display: grid; grid-template-columns: 84px 1fr; gap: 8px 12px; }
.dl dt { color: var(--faint); font-size: 12px; padding-top: 2px; }
.dl dd { word-break: break-all; }
</style>
