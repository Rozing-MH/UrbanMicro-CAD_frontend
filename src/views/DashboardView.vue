<template>
  <div class="dashboard-page">
    <header class="dash-header">
      <span class="logo">UrbanMicro-CAD</span>
      <div class="header-right">
        <span class="username">{{ username }}</span>
        <button class="logout-btn" @click="onLogout">退出</button>
      </div>
    </header>

    <main class="dash-body">
      <div class="dash-toolbar">
        <h1 class="dash-title">我的项目</h1>
        <button class="create-btn" :disabled="creating" @click="onCreateProject">
          {{ creating ? '创建中…' : '+ 新建项目' }}
        </button>
      </div>

      <div v-if="loadError" class="load-error">{{ loadError }}</div>

      <div v-if="loading" class="grid-placeholder">加载中…</div>
      <div v-else-if="projects.length === 0" class="grid-placeholder">暂无项目，点击「新建项目」开始</div>
      <ul v-else class="project-grid">
        <li
          v-for="p in projects"
          :key="p.id"
          class="project-card"
          @click="openProject(p.id)"
        >
          <div class="card-thumb">
            <img v-if="p.thumbnail" :src="p.thumbnail" alt="" />
            <div v-else class="card-thumb-placeholder">{{ p.name[0] }}</div>
          </div>
          <div class="card-body">
            <div class="card-name">{{ p.name }}</div>
            <div class="card-meta">{{ formatDate(p.updatedAt) }}</div>
            <div v-if="p.description" class="card-desc">{{ p.description }}</div>
          </div>
          <button
            class="card-delete"
            title="删除项目"
            @click.stop="onDeleteProject(p.id, p.name)"
          >✕</button>
        </li>
      </ul>
    </main>

    <div v-if="createDialogOpen" class="modal-overlay" @click.self="createDialogOpen = false">
      <div class="modal-box">
        <h2 class="modal-title">新建项目</h2>
        <label class="field">
          <span class="label">项目名称</span>
          <input v-model="newName" type="text" maxlength="80" placeholder="例：东城区改造方案" autofocus />
        </label>
        <label class="field">
          <span class="label">描述（可选）</span>
          <input v-model="newDesc" type="text" maxlength="200" placeholder="方案简介" />
        </label>
        <div v-if="createError" class="error">{{ createError }}</div>
        <div class="modal-actions">
          <button class="cancel-btn" @click="createDialogOpen = false">取消</button>
          <button class="confirm-btn" :disabled="!newName.trim() || creating" @click="submitCreate">
            {{ creating ? '创建中…' : '创建' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { authApi } from '@/api/authApi'
import { projectApi } from '@/api/projectApi'
import type { ProjectMeta } from '@/stores/projectStore'

const router = useRouter()

const username = ref('')
const projects = ref<ProjectMeta[]>([])
const loading = ref(false)
const loadError = ref('')
const creating = ref(false)
const createError = ref('')
const createDialogOpen = ref(false)
const newName = ref('')
const newDesc = ref('')

onMounted(async () => {
  const me = await authApi.me()
  if (me) username.value = me.username
  await loadProjects()
})

async function loadProjects(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    projects.value = await projectApi.list()
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : '加载失败'
  } finally {
    loading.value = false
  }
}

function onCreateProject(): void {
  newName.value = ''
  newDesc.value = ''
  createError.value = ''
  createDialogOpen.value = true
}

async function submitCreate(): Promise<void> {
  if (!newName.value.trim()) return
  creating.value = true
  createError.value = ''
  try {
    const p = await projectApi.create({ name: newName.value.trim(), description: newDesc.value.trim() })
    createDialogOpen.value = false
    await router.push(`/editor/${p.id}`)
  } catch (err) {
    createError.value = err instanceof Error ? err.message : '创建失败'
  } finally {
    creating.value = false
  }
}

async function openProject(id: string): Promise<void> {
  await router.push(`/editor/${id}`)
}

async function onDeleteProject(id: string, name: string): Promise<void> {
  if (!confirm(`确认删除项目「${name}」？此操作不可恢复。`)) return
  try {
    await projectApi.delete(id)
    projects.value = projects.value.filter(p => p.id !== id)
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : '删除失败'
  }
}

async function onLogout(): Promise<void> {
  await authApi.logout()
  await router.push('/login')
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<style scoped>
.dashboard-page { display: flex; flex-direction: column; height: 100%; background: var(--color-bg-page); }
.dash-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 28px; height: 48px;
  background: linear-gradient(180deg, #2a2f3a 0%, #232831 100%);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}
.logo { font-size: 16px; font-weight: 700; color: var(--color-accent-bright); }
.header-right { display: flex; align-items: center; gap: 14px; }
.username { font-size: 12px; color: var(--color-text-muted); }
.logout-btn {
  padding: 5px 12px; border-radius: var(--radius-md);
  background: transparent; border: 1px solid var(--color-border-strong);
  color: var(--color-text-muted); font-size: 12px;
}
.logout-btn:hover { background: var(--color-bg-elevated); color: var(--color-text-primary); }
.dash-body { flex: 1; overflow-y: auto; padding: 28px 32px; }
.dash-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
.dash-title { font-size: 20px; font-weight: 600; color: var(--color-text-primary); }
.create-btn {
  padding: 8px 18px; border-radius: var(--radius-md);
  background: var(--color-accent-bg); border: none; color: #fff; font-weight: 600;
}
.create-btn:hover:not(:disabled) { background: #356eb0; }
.create-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.load-error {
  padding: 8px 12px; margin-bottom: 16px; border-radius: var(--radius-sm);
  background: rgba(161,60,60,.15); color: #e89090; border: 1px solid rgba(161,60,60,.3); font-size: 12px;
}
.grid-placeholder { padding: 48px 0; text-align: center; color: var(--color-text-muted); font-size: 13px; }
.project-grid { list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
.project-card {
  position: relative;
  background: var(--color-bg-panel); border: 1px solid var(--color-border);
  border-radius: 6px; cursor: pointer; overflow: hidden;
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
}
.project-card:hover { border-color: var(--color-accent); box-shadow: var(--shadow-md); }
.card-thumb {
  width: 100%; height: 140px;
  background: linear-gradient(135deg, #1a1e26 0%, #232831 100%);
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.card-thumb img { width: 100%; height: 100%; object-fit: cover; }
.card-thumb-placeholder { font-size: 48px; font-weight: 700; color: var(--color-border-strong); }
.card-body { padding: 12px 14px; }
.card-name { font-size: 14px; font-weight: 600; color: var(--color-text-primary); }
.card-meta { margin-top: 4px; font-size: 11px; color: var(--color-text-dim); }
.card-desc { margin-top: 6px; font-size: 11px; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card-delete {
  position: absolute; top: 8px; right: 8px;
  width: 22px; height: 22px;
  background: rgba(30,34,42,0.85); border: 1px solid var(--color-border-strong);
  color: var(--color-text-muted); border-radius: var(--radius-sm); font-size: 10px;
  opacity: 0; transition: opacity var(--duration-fast);
}
.project-card:hover .card-delete { opacity: 1; }
.card-delete:hover { background: var(--color-danger); color: #fff; border-color: var(--color-danger); }
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.55);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.modal-box {
  width: 380px;
  background: var(--color-bg-panel); border: 1px solid var(--color-border);
  border-radius: 8px; padding: 24px 24px 20px;
  box-shadow: var(--shadow-lg);
}
.modal-title { font-size: 15px; font-weight: 600; color: var(--color-text-primary); margin-bottom: 18px; }
.field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 14px; }
.label { font-size: 11px; color: var(--color-text-muted); }
.field input { padding: 7px 10px; font-size: 13px; }
.error { padding: 6px 10px; margin-bottom: 10px; font-size: 12px; background: rgba(161,60,60,.15); color: #e89090; border: 1px solid rgba(161,60,60,.3); border-radius: var(--radius-sm); }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; }
.cancel-btn { padding: 7px 14px; background: transparent; border: 1px solid var(--color-border-strong); color: var(--color-text-secondary); border-radius: var(--radius-md); }
.cancel-btn:hover { background: var(--color-bg-elevated); }
.confirm-btn { padding: 7px 16px; background: var(--color-accent-bg); border: none; color: #fff; font-weight: 600; border-radius: var(--radius-md); }
.confirm-btn:hover:not(:disabled) { background: #356eb0; }
.confirm-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
