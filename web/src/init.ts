/** 应用初始化模块：请求逻辑收敛在这里与 store action（用户交互）中，
 * 组件只从状态管理器读数据。放数据前先问一句："这个数据放在哪里合适"。
 *
 * - initApp：启动时恢复登录态（App 挂载调用一次）
 * - loadUserData：登录态就绪后，把用户数据与静态配置装入各 store
 *   （登录成功 / 刷新恢复时由 App 按状态变化触发一次）
 */

import { useAuth } from './stores/auth'
import { useRaid } from './stores/raid'
import { useTeam } from './stores/team'
import { useWarehouse } from './stores/warehouse'

export function initApp(): Promise<void> {
  return useAuth.getState().init()
}

export async function loadUserData(): Promise<void> {
  if (useAuth.getState().status !== 'authed') return
  await Promise.allSettled([
    useTeam.getState().load(),
    useRaid.getState().load(),
    useTeam.getState().fetchSects(),
    useRaid.getState().fetchDungeons(),
    useWarehouse.getState().load(),
  ])
  // 首屏数据就绪后开始副本进度轮询（幂等；登出/失效时由 App 停表）
  useRaid.getState().startPolling()
}

/** 登出 / 会话失效时停掉副本进度轮询（App 按认证状态调用） */
export function stopRaidPolling(): void {
  useRaid.getState().stopPolling()
}
