<template>
  <div v-if="visible" class="modal-overlay" @click.self="onClose">
    <div class="modal-box">
      <div class="modal-header">
        <h2 class="modal-title">历史版本</h2>
        <button class="close-btn" title="关闭" @click="onClose">✕</button>
      </div>

      <div v-if="loading" class="loading-state">加载中…</div>
      <div v-else-if="error" class="error-state">{{ error }}</div>
      <div v-else-if="snapshots.length === 0" class="empty-state">暂无保存记录</div>
      <ul v-else class="snapshot-list">
        <li
          v-for="s in snapshots"
          :key="s.version"
          class="snapshot-item"
        >
          <div class="snapshot-info">
            <span class="version-badge">v{{ s.version }}</span>
            <div class="snapshot-detail">
              <span class="snapshot-desc">{{ s.description || '自动保存' }}</span>
              <span class="snapshot-time">{{ formatDate(s.createdAt) }}</span>
            </div>
          </div>
          <button
            class="rollback-btn"
            :disabled="rollingBack !== null"
            @click="onRollback(s.version)"
          >
            {{ rollingBack === s.version ? '恢复中…' : '回滚' }}
          </button>
        </li>
      </ul>

      <div v-if="total > pageSize" class="pagination">
        <button
          class="page-btn"
          :disabled="page <= 1"
          @click="onPageChange(page - 1)"
        >上一页</button>
        <span class="page-info">{{ page }} / {{ totalPages }}</span>
        <button
          class="page-btn"
          :disabled="page >= totalPages"
          @click="onPageChange(page + 1)"
        >下一页</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useProjectStore, type SnapshotInfo } from '@/stores/projectStore'
import { useEditorStateStore } from '@/stores/editorStateStore'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'rolled-back'): void
}>()

const project = useProjectStore()
const editor = useEditorStateStore()

const loading = ref(false)
const error = ref('')
const page = ref(1)
const pageSize = 20
const rollingBack = ref<number | null>(null)

const snapshots = computed<SnapshotInfo[]>(() => project.snapshots)
const total = computed<number>(() => project.snapshotsTotal)
const totalPages = computed<number>(() => Math.max(1, Math.ceil(total.value / pageSize)))

watch(() => props.visible, (visible) => {
  if (visible && project.currentProject) {
    page.value = 1
    void loadSnapshots()
  }
})

async function loadSnapshots(): Promise<void> {
  if (!project.currentProject) return
  loading.value = true
  error.value = ''
  try {
    await project.fetchSnapshots(project.currentProject.id, page.value, pageSize)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载快照列表失败'
  } finally {
    loading.value = false
  }
}

function onPageChange(newPage: number): void {
  page.value = newPage
  void loadSnapshots()
}

async function onRollback(version: number): Promise<void> {
  if (!project.currentProject) return
  if (!confirm(`确认回滚到版本 v${version}？当前未保存的修改将丢失。`)) return

  rollingBack.value = version
  try {
    await project.loadSnapshot(project.currentProject.id, version)
    editor.showNotification({
      type: 'success',
      message: `已回滚到版本 v${version}`,
      durationMs: 3000,
    })
    emit('rolled-back')
  } catch (err) {
    editor.showNotification({
      type: 'error',
      message: err instanceof Error ? err.message : '回滚失败',
      durationMs: 5000,
    })
  } finally {
    rollingBack.value = null
  }
}

function onClose(): void {
  project.clearSnapshots()
  emit('close')
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex; align-items: center; justify-content: center;
  z-index: 200;
}
.modal-box {
  width: 480px; max-height: 560px;
  background: var(--color-bg-panel, #1e222a);
  border: 1px solid var(--color-border, #383e4a);
  border-radius: 8px;
  display: flex; flex-direction: column;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}
.modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--color-border, #383e4a);
}
.modal-title { font-size: 15px; font-weight: 600; color: #d8dde6; margin: 0; }
.close-btn {
  width: 26px; height: 26px;
  background: transparent; border: 1px solid #383e4a; border-radius: 4px;
  color: #aab2bf; cursor: pointer; font-size: 12px;
}
.close-btn:hover { background: #313847; color: #fff; }

.loading-state,
.empty-state,
.error-state {
  padding: 40px 20px; text-align: center;
  color: #8b929e; font-size: 13px;
}
.error-state { color: #e89090; }

.snapshot-list {
  list-style: none; margin: 0; padding: 8px 12px;
  overflow-y: auto; flex: 1;
}
.snapshot-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px; border-radius: 6px;
  transition: background 0.15s;
}
.snapshot-item:hover { background: #282d38; }
.snapshot-info { display: flex; align-items: center; gap: 10px; }
.version-badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 40px; padding: 2px 8px;
  background: #2c5d99; color: #fff; border-radius: 4px;
  font-size: 11px; font-weight: 600;
}
.snapshot-detail { display: flex; flex-direction: column; gap: 2px; }
.snapshot-desc { font-size: 13px; color: #d8dde6; }
.snapshot-time { font-size: 11px; color: #8b929e; }

.rollback-btn {
  padding: 4px 12px; border-radius: 4px;
  background: #3a6e45; border: none;
  color: #fff; cursor: pointer; font-size: 12px;
}
.rollback-btn:hover:not(:disabled) { background: #468352; }
.rollback-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.pagination {
  display: flex; align-items: center; justify-content: center; gap: 12px;
  padding: 10px 20px 14px;
  border-top: 1px solid var(--color-border, #383e4a);
}
.page-btn {
  padding: 4px 10px; border-radius: 4px;
  background: #2c5d99; border: none;
  color: #fff; cursor: pointer; font-size: 12px;
}
.page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.page-btn:hover:not(:disabled) { background: #356eb0; }
.page-info { font-size: 12px; color: #aab2bf; }
</style>
