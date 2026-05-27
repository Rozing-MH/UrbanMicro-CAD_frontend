import apiClient, { getApiError, isApiSuccess, type ApiResponse, type PageResponse } from './client'
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
    const res = await apiClient.get<ApiResponse<ProjectDTO[] | PageResponse<ProjectDTO>>>('/projects')
    const data = res.data.data
    if (!data) return []
    const items = Array.isArray(data)
      ? data
      : data.records ?? data.content ?? data.items ?? []
    return items.map(dtoToProjectMeta)
  },

  async get(id: string): Promise<ProjectSnapshot> {
    const res = await apiClient.get<ApiResponse<ProjectDTO>>(`/projects/${id}`)
    if (!res.data.data) throw new Error('Project not found')
    return dtoToSnapshot(res.data.data)
  },

  async create(meta: Partial<ProjectMeta>): Promise<ProjectMeta> {
    const res = await apiClient.post<ApiResponse<ProjectDTO>>('/projects', {
      name: meta.name,
      description: meta.description ?? '',
    })
    if (!res.data.data) throw new Error('Create failed')
    return dtoToProjectMeta(res.data.data)
  },

  async save(id: string, snapshot: ProjectSnapshot): Promise<void> {
    const res = await apiClient.put<ApiResponse<unknown>>(`/projects/${id}/snapshot`, {
      topologyData: snapshot.topology,
      ruleData: snapshot.rules,
      description: snapshot.meta.description,
    })
    if (!isApiSuccess(res.data)) {
      throw new Error(getApiError(res.data, 'Save failed'))
    }
  },

  async delete(id: string): Promise<void> {
    await apiClient.delete(`/projects/${id}`)
  },
}
