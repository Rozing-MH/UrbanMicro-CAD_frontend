<template>
  <div class="login-page">
    <div class="login-card">
      <div class="brand">
        <div class="logo">UrbanMicro-CAD</div>
        <div class="tagline">城市微观路网参数化设计 · 仿真评估平台</div>
      </div>

      <div class="tabs">
        <button class="tab" :class="{ active: mode === 'login' }" @click="mode = 'login'">登录</button>
        <button class="tab" :class="{ active: mode === 'register' }" @click="mode = 'register'">注册</button>
      </div>

      <form class="form" @submit.prevent="onSubmit">
        <label class="field">
          <span class="label">用户名</span>
          <input v-model="username" type="text" required autocomplete="username" :disabled="loading" />
        </label>

        <label v-if="mode === 'register'" class="field">
          <span class="label">邮箱</span>
          <input v-model="email" type="email" required autocomplete="email" :disabled="loading" />
        </label>

        <label class="field">
          <span class="label">密码</span>
          <input v-model="password" type="password" required autocomplete="current-password" :disabled="loading" />
        </label>

        <div v-if="errorMessage" class="error">{{ errorMessage }}</div>

        <button class="submit-btn" type="submit" :disabled="loading">
          {{ loading ? '请稍候…' : (mode === 'login' ? '登录' : '注册') }}
        </button>
      </form>

      <div class="footer-tip">© 2026 UrbanMicro-CAD</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { authApi } from '@/api/authApi'

type Mode = 'login' | 'register'
const mode = ref<Mode>('login')

const username = ref('')
const password = ref('')
const email = ref('')
const errorMessage = ref('')
const loading = ref(false)

async function onSubmit(): Promise<void> {
  errorMessage.value = ''
  loading.value = true
  try {
    if (mode.value === 'login') {
      await authApi.login({ username: username.value, password: password.value })
      location.href = '/dashboard'
    } else {
      await authApi.register({ username: username.value, password: password.value, email: email.value })
      await authApi.login({ username: username.value, password: password.value })
      location.href = '/dashboard'
    }
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : '操作失败'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at 20% 20%, rgba(74, 140, 208, 0.12), transparent 50%),
    radial-gradient(circle at 80% 80%, rgba(108, 182, 255, 0.08), transparent 50%),
    linear-gradient(135deg, #0f1216 0%, #1a1e26 100%);
}
.login-card {
  width: 360px;
  background: linear-gradient(180deg, #232831 0%, #1c2029 100%);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 32px 28px;
  box-shadow: var(--shadow-lg);
}
.brand { text-align: center; margin-bottom: 24px; }
.logo { font-size: 22px; font-weight: 700; color: var(--color-accent-bright); letter-spacing: 0.5px; }
.tagline { margin-top: 6px; font-size: 11px; color: var(--color-text-muted); }
.tabs { display: flex; gap: 0; margin-bottom: 20px; border-bottom: 1px solid var(--color-border); }
.tab {
  flex: 1; padding: 10px 0;
  background: transparent; border: none;
  color: var(--color-text-muted); font-size: 13px;
}
.tab.active { color: #fff; border-bottom: 2px solid var(--color-accent); }
.form { display: flex; flex-direction: column; gap: 14px; }
.field { display: flex; flex-direction: column; gap: 5px; }
.label { font-size: 11px; color: var(--color-text-muted); }
.field input { padding: 8px 10px; font-size: 13px; }
.error {
  padding: 6px 10px; font-size: 12px;
  background: rgba(161, 60, 60, 0.15); color: #e89090;
  border: 1px solid rgba(161, 60, 60, 0.35);
  border-radius: var(--radius-sm);
}
.submit-btn {
  margin-top: 4px; padding: 10px;
  background: var(--color-accent-bg); color: #fff; border: none; border-radius: var(--radius-md);
  font-weight: 600;
}
.submit-btn:hover:not(:disabled) { background: #356eb0; }
.submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.footer-tip { margin-top: 20px; text-align: center; font-size: 11px; color: var(--color-text-dim); }
</style>
