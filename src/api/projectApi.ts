import apiClient, { type ApiResponse } from './client'
import type { ProjectDTO, ProjectMeta, ProjectSnapshot } from '@/stores/projectStore'

function dtoToProjectMeta(dto: ProjectDTO): ProjectMeta {
  return {
    id: dto.id,
    name: dto.name,
    description: dto.description,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    ownerId: dto.ownerId,
    thumbnail: dto.thumbnailUrl,
  }
}

function dtoToSnapshot(dto: ProjectDTO): ProjectSnapshot {
  return {
    meta: dtoToProjectMeta(dto),
    topology: dto.topologyData,
    rules: dto.ruleData,
    odMatrix: { pairs: dto.ruleData.odConfig?.pairs ?? [] },
  }
}

export const projectApi = {
  async list(): Promise<ProjectMeta[]> {
    const res = await apiClient.get<ApiResponse<ProjectMeta[]>>('/projects')
    return res.data.data ?? []
  },

  async get(id: string): Promise<ProjectSnapshot> {
    const res = await apiClient.get<ApiResponse<ProjectDTO>>(`/projects/${id}`)
    if (!res.data.data) throw new Error('Project not found')
    return dtoToSnapshot(res.data.data)
  },

  async create(meta: Partial<ProjectMeta>): Promise<ProjectMeta> {
    const res = await apiClient.post<ApiResponse<ProjectMeta>>('/projects', meta)
    if (!res.data.data) throw new Error('Create failed')
    return res.data.data
  },

  async save(id: string, snapshot: ProjectSnapshot): Promise<void> {
    const res = await apiClient.put<ApiResponse<void>>(`/projects/${id}/snapshot`, {
      topologyData: snapshot.topology,
      ruleData: snapshot.rules,
      description: snapshot.meta.description,
    })
    if (!res.data.success) {
      throw new Error(res.data.error || 'Save failed')
    }
  },

  async delete(id: string): Promise<void> {
    await apiClient.delete(`/projects/${id}`)
  },
}
