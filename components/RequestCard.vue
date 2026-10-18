<script setup lang="ts">
import type { SecretRequest } from '~/server/lib/types'
import { relativeTime } from '~/utils/time'
defineProps<{ r: SecretRequest }>()
const label: Record<string, string> = { pending: '待處理', fulfilled: '已寫入', cancelled: '已取消' }
</script>
<template>
  <NuxtLink :to="`/requests/${r.id}`" class="card">
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline">
      <div style="font-weight:600">{{ r.session }}</div>
      <span class="badge" :class="r.status">{{ label[r.status] }}</span>
    </div>
    <div class="mono muted" style="margin-top:4px">{{ r.mode === 'env' ? `${r.key} → ` : '' }}{{ r.path }}</div>
    <div style="margin-top:6px">{{ r.description }}</div>
    <div class="faint" style="margin-top:6px">{{ relativeTime(r.createdAt) }}</div>
  </NuxtLink>
</template>
