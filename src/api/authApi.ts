import apiClient, { setToken, clearToken, type ApiResponse } from './client'

export interface LoginRequest {
  username: string
  password: string
}

export interface LoginResponse {
  token: string
  userId: string
  username: string
  role: string
}

export interface RegisterRequest {
  username: string
  password: string
  email: string
}

export const authApi = {
  async login(req: LoginRequest): Promise<LoginResponse> {
    const res = await apiClient.post<ApiResponse<LoginResponse>>('/auth/login', req)
    if (!res.data.success || !res.data.data) {
      throw new Error(res.data.error || 'Login failed')
    }
    setToken(res.data.data.token)
    return res.data.data
  },

  async register(req: RegisterRequest): Promise<void> {
    const res = await apiClient.post<ApiResponse<void>>('/auth/register', req)
    if (!res.data.success) {
      throw new Error(res.data.error || 'Registration failed')
    }
  },

  async logout(): Promise<void> {
    try {
      await apiClient.post('/auth/logout')
    } finally {
      clearToken()
    }
  },

  async me(): Promise<LoginResponse | null> {
    try {
      const res = await apiClient.get<ApiResponse<LoginResponse>>('/auth/me')
      return res.data.data ?? null
    } catch {
      return null
    }
  },
}
