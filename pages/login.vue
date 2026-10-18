<script setup lang="ts">
const token = ref('')
const error = ref('')
async function submit() {
  error.value = ''
  try {
    await $fetch('/api/login', { method: 'POST', body: { token: token.value } })
    await navigateTo('/')
  } catch { error.value = 'token 不正確' }
}
</script>
<template>
  <main style="display:grid;place-items:center;min-height:100dvh">
    <form @submit.prevent="submit" style="display:flex;flex-direction:column;gap:12px;width:280px">
      <div class="brand">tele<b>cipher</b></div>
      <input v-model="token" type="password" placeholder="access token" autofocus autocomplete="off" />
      <button type="submit" class="btn primary">進入</button>
      <div v-if="error" class="err">{{ error }}</div>
    </form>
  </main>
</template>
