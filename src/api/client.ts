import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios'

const TOKEN_KEY = 'urbanmicro_jwt'

export interface ApiResponse<T> {
  success?: boolean
  code?: number
  message?: string
  data?: T
  error?: string
  meta?: {
    total: number
    page: number
    limit: number
  }
}

export interface PageResponse<T> {
  records?: T[]
  content?: T[]
  items?: T[]
  total: number
  page?: number
  size?: number
  limit?: number
}

export function isApiSuccess<T>(res: ApiResponse<T>): boolean {
  if (typeof res.success === 'boolean') return res.success
  if (typeof res.code === 'number') return res.code >= 200 && res.code < 300
  return true
}

export function getApiError<T>(res: ApiResponse<T>, fallback: string): string {
  return res.error || res.message || fallback
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

const apiClient: AxiosInstance = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = getToken()
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error: AxiosError) => Promise.reject(error),
)

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      clearToken()
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  },
)

export default apiClient
