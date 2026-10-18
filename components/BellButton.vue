<script setup lang="ts">
const { supported, permission, subscribed, refresh, subscribe, unsubscribe } = usePush()
onMounted(refresh)
function onBell() { if (!supported.value || permission.value === 'denied') return; subscribed.value ? unsubscribe() : subscribe() }
const title = computed(() => !supported.value ? '此裝置不支援推播（需安裝為 PWA）'
  : permission.value === 'denied' ? '通知已被封鎖（去設定解鎖）'
  : subscribed.value ? '關閉新需求通知' : '開啟新需求通知')
</script>
<template>
  <button class="bell" :class="{ on: subscribed, dim: !supported || permission === 'denied' }" :title="title" :aria-label="title" @click="onBell">
    <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8 2a3.5 3.5 0 0 0-3.5 3.5c0 3-1.2 4-1.5 4.5h10c-.3-.5-1.5-1.5-1.5-4.5A3.5 3.5 0 0 0 8 2z" />
      <path d="M6.7 12.5a1.4 1.4 0 0 0 2.6 0" />
      <path v-if="!supported || permission === 'denied'" d="M3 3l10 10" stroke-width="1.4" />
    </svg>
  </button>
</template>
<style scoped>
.bell { background: transparent; border: 1px solid var(--hairline); border-radius: 8px; padding: 6px; color: var(--muted); display: grid; place-items: center; }
.bell.on { color: var(--ember); border-color: var(--ember-line); background: var(--ember-dim); }
.bell.dim { opacity: .5; }
</style>
