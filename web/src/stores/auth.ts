import { create } from 'zustand'

import { refreshSession, request, tokens } from '../api/client'

export interface User {
  id: number
  username: string
}

type Status = 'loading' | 'authed' | 'anon' | 'offline'

interface AuthState {
  user: User | null
  status: Status
  init: () => Promise<void>
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string) => Promise<void>
  logout: () => void
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  status: 'loading',

  init: async () => {
    if (!tokens.refresh) {
      set({ status: 'anon' })
      return
    }
    const result = await refreshSession()
    if (result === 'ok') {
      try {
        const me = await request<{ id: number; username: string }>('/api/auth/me')
        set({ user: me, status: 'authed' })
      } catch {
        tokens.clear()
        set({ status: 'anon' })
      }
    } else if (result === 'invalid') {
      tokens.clear()
      set({ status: 'anon' })
    } else {
      set({ status: 'offline' })
    }
  },

  login: async (username, password) => {
    const data = await request<{
      access_token: string
      refresh_token: string
      user: User
    }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    tokens.set(data.access_token, data.refresh_token)
    set({ user: data.user, status: 'authed' })
  },

  register: async (username, password) => {
    await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
  },

  logout: () => {
    tokens.clear()
    set({ user: null, status: 'anon' })
  },
}))
