import apiClient, { type ApiResponse } from './client'
import type { ProjectMeta, ProjectSnapshot } from '@/stores/projectStore'

export const projectApi = {
  async list(): Promise<ProjectMeta[]> {
    const res = await apiClient.get<ApiResponse<ProjectMeta[]>>('/projects')
    return res.data.data ?? []
  },

  async get(id: string): Promise<ProjectSnapshot> {
    const res = await apiClient.get<ApiResponse<ProjectSnapshot>>(`/projects/${id}`)
    if (!res.data.data) throw new Error('Project not found')
    return res.data.data
  },

  async create(meta: Partial<ProjectMeta>): Promise<ProjectMeta> {
    const res = await apiClient.post<ApiResponse<ProjectMeta>>('/projects', meta)
    if (!res.data.data) throw new Error('Create failed')
    return res.data.data
  },

  async save(id: string, snapshot: ProjectSnapshot): Promise<void> {
    const res = await apiClient.put<ApiResponse<void>>(`/projects/${id}`, snapshot)
    if (!res.data.success) {
      throw new Error(res.data.error || 'Save failed')
    }
  },

  async delete(id: string): Promise<void> {
    await apiClient.delete(`/projects/${id}`)
  },
}
