import apiClient, { getApiError, isApiSuccess, type ApiResponse, type PageResponse } from './client'
import type { ProjectDTO, ProjectMeta, ProjectSnapshot, SnapshotInfo } from '@/stores/projectStore'

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

/** 快照摘要 DTO（后端响应结构） */
interface SnapshotInfoDTO {
  id: number
  projectId: string
  version: number
  description: string
  createdAt: string
}

function dtoToSnapshotInfo(dto: SnapshotInfoDTO): SnapshotInfo {
  return {
    id: dto.id,
    projectId: dto.projectId,
    version: dto.version,
    description: dto.description,
    createdAt: dto.createdAt,
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

  /** 获取工程快照版本列表，返回领域类型 */
  async listSnapshots(
    projectId: string,
    page: number = 1,
    size: number = 20,
  ): Promise<{ items: SnapshotInfo[]; total: number }> {
    const res = await apiClient.get<ApiResponse<SnapshotInfoDTO[] | PageResponse<SnapshotInfoDTO>>>(
      `/projects/${projectId}/snapshots`,
      { params: { page, size } },
    )
    const data = res.data.data
    if (!data) return { items: [], total: 0 }
    if (Array.isArray(data)) {
      return { items: data.map(dtoToSnapshotInfo), total: data.length }
    }
    const items = data.records ?? data.content ?? data.items ?? []
    return { items: items.map(dtoToSnapshotInfo), total: data.total ?? items.length }
  },

  /** 加载指定版本的快照 */
  async getSnapshot(projectId: string, version: number): Promise<ProjectSnapshot> {
    const res = await apiClient.get<ApiResponse<ProjectDTO>>(
      `/projects/${projectId}/snapshots/${version}`,
    )
    if (!res.data.data) throw new Error('Snapshot not found')
    return dtoToSnapshot(res.data.data)
  },
}
