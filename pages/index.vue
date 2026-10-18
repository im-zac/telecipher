<script setup lang="ts">
const { pending, done, loading, error, refresh, clearDone } = useRequests()
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { refresh(); timer = setInterval(refresh, 15000) })
onUnmounted(() => clearInterval(timer))
</script>
<template>
  <main class="wrap">
    <header style="display:flex;justify-content:space-between;align-items:center">
      <div class="brand">tele<b>cipher</b></div>
      <BellButton />
    </header>
    <div v-if="error" class="err" style="margin-top:12px">{{ error }}</div>

    <h2>待處理 <span class="faint">{{ pending.length }}</span></h2>
    <div v-if="!pending.length && !loading" class="faint">沒有待處理的需求。</div>
    <RequestCard v-for="r in pending" :key="r.id" :r="r" />

    <h2 style="display:flex;justify-content:space-between;align-items:baseline">
      <span>已處理</span>
      <button v-if="done.length" class="btn ghost" style="padding:4px 10px;font-size:12px;text-transform:none;letter-spacing:0" @click="clearDone">清除已處理</button>
    </h2>
    <div v-if="!done.length && !loading" class="faint">尚無已處理項目。</div>
    <RequestCard v-for="r in done" :key="r.id" :r="r" />
  </main>
</template>
