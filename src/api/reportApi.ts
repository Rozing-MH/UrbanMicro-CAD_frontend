import apiClient, { type ApiResponse } from './client'

export interface ReportSummary {
  id: string
  projectId: string
  createdAt: string
  networkLOS: string
  averageDelay: number
}

export const reportApi = {
  async generate(projectId: string, snapshot: unknown): Promise<ReportSummary> {
    const res = await apiClient.post<ApiResponse<ReportSummary>>(`/reports/generate`, { projectId, snapshot })
    if (!res.data.data) throw new Error('Report generation failed')
    return res.data.data
  },

  async list(projectId: string): Promise<ReportSummary[]> {
    const res = await apiClient.get<ApiResponse<ReportSummary[]>>(`/reports?projectId=${projectId}`)
    return res.data.data ?? []
  },

  async download(reportId: string): Promise<Blob> {
    const res = await apiClient.get(`/reports/${reportId}/download`, { responseType: 'blob' })
    return res.data as Blob
  },
}
