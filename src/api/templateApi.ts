import apiClient, { type ApiResponse } from './client'
import type { CrossSectionProfile } from '@/types/road-network'

export interface TemplateDTO {
  id: string
  name: string
  category: string
  snapshotData?: unknown
  thumbnailUrl?: string
  profile?: CrossSectionProfile
}

function extractCrossSection(template: TemplateDTO): CrossSectionProfile | null {
  if (template.profile) return template.profile
  const snapshot = template.snapshotData as { profile?: CrossSectionProfile; topology?: { segments?: Array<{ profile?: CrossSectionProfile }> } } | undefined
  return snapshot?.profile ?? snapshot?.topology?.segments?.[0]?.profile ?? null
}

export const templateApi = {
  async listCrossSections(): Promise<CrossSectionProfile[]> {
    try {
      const res = await apiClient.get<ApiResponse<TemplateDTO[]>>('/templates?category=ROAD_SECTION')
      return (res.data.data ?? []).map(extractCrossSection).filter((p): p is CrossSectionProfile => !!p)
    } catch {
      const res = await apiClient.get<ApiResponse<CrossSectionProfile[]>>('/templates/cross-sections')
      return res.data.data ?? []
    }
  },

  async getCrossSection(id: string): Promise<CrossSectionProfile | null> {
    try {
      const res = await apiClient.get<ApiResponse<TemplateDTO>>(`/templates/${id}`)
      return res.data.data ? extractCrossSection(res.data.data) : null
    } catch {
      const res = await apiClient.get<ApiResponse<CrossSectionProfile>>(`/templates/cross-sections/${id}`)
      return res.data.data ?? null
    }
  },

  async listAssets(category?: string): Promise<Array<{ id: string; name: string; category: string; thumbnail: string }>> {
    try {
      const url = category ? `/templates?category=${encodeURIComponent(category)}` : '/templates'
      const res = await apiClient.get<ApiResponse<TemplateDTO[]>>(url)
      return (res.data.data ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        category: t.category,
        thumbnail: t.thumbnailUrl ?? '',
      }))
    } catch {
      const url = category ? `/templates/assets?category=${encodeURIComponent(category)}` : '/templates/assets'
      const res = await apiClient.get<ApiResponse<Array<{ id: string; name: string; category: string; thumbnail: string }>>>(url)
      return res.data.data ?? []
    }
  },
}
