/** API 客户端：统一错误信封处理 + 401 静默续期 + 网络不可达三态识别。

规约要点：
- 错误信封 {code, detail}；401+40101 → 用 refresh 静默续期 → 重放原请求（单飞锁防并发刷新）
- 网络不可达（fetch 异常 / 502/503/504 / 500 且非 JSON 错误体）一律视为「服务暂不可用」，
  绝不与登录失效混淆，不登出
- 只有明确的 40102（refresh 失效）才清除本地登录态
*/

export class ApiError extends Error {
  status: number
  code?: number

  constructor(status: number, code?: number, detail?: string) {
    super(detail ?? (status === -1 ? '服务暂不可用' : `请求失败(${status})`))
    this.status = status
    this.code = code
  }
}

const ACCESS_KEY = 'gl_access'
const REFRESH_KEY = 'gl_refresh'

export const tokens = {
  get access() {
    return localStorage.getItem(ACCESS_KEY)
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY)
  },
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS_KEY, access)
    localStorage.setItem(REFRESH_KEY, refresh)
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
  },
}

export type RefreshResult = 'ok' | 'invalid' | 'offline'

async function doRefresh(): Promise<RefreshResult> {
  const refresh = tokens.refresh
  if (!refresh) return 'invalid'
  let res: Response
  try {
    res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    })
  } catch {
    return 'offline'
  }
  if (res.ok) {
    const data = await res.json()
    tokens.set(data.access_token, data.refresh_token)
    return 'ok'
  }
  // 500 且错误体非 JSON（代理错误页）→ 按不可达处理；明确 40102 才算失效
  let code: number | undefined
  try {
    code = (await res.json())?.code
  } catch {
    return 'offline'
  }
  return code === 40102 ? 'invalid' : 'offline'
}

let refreshing: Promise<RefreshResult> | null = null

export function refreshSession(): Promise<RefreshResult> {
  refreshing ??= doRefresh().finally(() => {
    refreshing = null
  })
  return refreshing
}

export async function request<T = unknown>(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {}),
        ...options.headers,
      },
    })
  } catch {
    throw new ApiError(-1, undefined, '服务暂不可用，请稍后重试')
  }
  if (res.ok) return res.json() as Promise<T>

  let code: number | undefined
  let detail: string | undefined
  try {
    const body = await res.json()
    code = body?.code
    detail = body?.detail
  } catch {
    throw new ApiError(-1, undefined, '服务暂不可用，请稍后重试')
  }
  if (res.status === 401 && code === 40101 && retry) {
    const result = await refreshSession()
    if (result === 'ok') return request<T>(path, options, false)
    if (result === 'invalid') {
      tokens.clear()
      throw new ApiError(401, 40102, '登录已失效，请重新登录')
    }
    throw new ApiError(-1, undefined, '服务暂不可用，请稍后重试')
  }
  throw new ApiError(res.status, code, detail)
}
