import apiClient, { type ApiResponse } from './client'
import type { CrossSectionProfile } from '@/types/road-network'

export const templateApi = {
  async listCrossSections(): Promise<CrossSectionProfile[]> {
    const res = await apiClient.get<ApiResponse<CrossSectionProfile[]>>('/templates/cross-sections')
    return res.data.data ?? []
  },

  async getCrossSection(id: string): Promise<CrossSectionProfile | null> {
    const res = await apiClient.get<ApiResponse<CrossSectionProfile>>(`/templates/cross-sections/${id}`)
    return res.data.data ?? null
  },

  async listAssets(category?: string): Promise<Array<{ id: string; name: string; category: string; thumbnail: string }>> {
    const url = category ? `/templates/assets?category=${encodeURIComponent(category)}` : '/templates/assets'
    const res = await apiClient.get<ApiResponse<Array<{ id: string; name: string; category: string; thumbnail: string }>>>(url)
    return res.data.data ?? []
  },
}
