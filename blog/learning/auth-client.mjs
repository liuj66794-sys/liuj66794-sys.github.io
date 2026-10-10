import { getStudyStorage } from './study-storage.mjs'
import { multiuserConfig } from './multiuser-config.mjs'
import { tabAuthStorage, clearTabAuthStorage } from './tab-auth-storage.mjs'
import { consumeEmailConfirmation } from './email-confirmation.mjs'
let emailConfirmation=typeof window==='undefined'?null:consumeEmailConfirmation(window.location,window.history,multiuserConfig.callbackUrl)
export const hasEmailConfirmation=()=>Boolean(emailConfirmation)
export const AUTH_EVENT = 'zhixu:auth'
export function createAuthClient({ client, storage, changed = () => {}, initialRecovery = false, invalidated = () => {} }) {
  let session = null, recovery = initialRecovery, ready = false
  const apply = (next, event) => {
    const before = storage.owner
    session = next
    recovery = event === 'PASSWORD_RECOVERY' || (recovery && Boolean(next))
    if (before !== (next?.user?.id ?? null)) storage.setOwner(next?.user?.id ?? null)
    changed({ user: next?.user ?? null, recovery, previousOwner: before, identityChanged: before !== storage.owner })
  }
  const subscription = client.auth.onAuthStateChange((event, next) => {
    if (!ready) { session = next; if(event === 'PASSWORD_RECOVERY')recovery = true; return }
    apply(next,event)
  }).data.subscription
  async function result(operation) { const { data, error } = await operation; if (error) throw new Error(error.message); return data }
  return {
    client,
    get session() { return session },
    get recovery() { return recovery },
    async init() {
      const cached = await client.auth.getSession()
      if(cached.error){
        if([400,401,403].includes(cached.error.status))invalidated()
        throw new Error('无法恢复登录状态，请稍后重试或重新登录')
      }
      const data=cached.data
      if (data?.session) {
        const checked = await client.auth.getUser()
        const offline = checked.error && (!checked.error.status || checked.error.status >= 500)
          && storage.owner === data.session.user.id && data.session.expires_at * 1000 > Date.now()
        if (!offline && (checked.error || !checked.data?.user || checked.data.user.id !== data.session.user.id)) {
          // Only authoritative rejection clears credentials. A transport/server
          // failure preserves the per-tab session for offline recovery.
          if(!checked.error || [400,401,403,404].includes(checked.error.status))invalidated()
          throw new Error('登录状态失效，请重新登录')
        }
      }
      ready = true
      apply(data?.session ?? null, 'INITIAL_SESSION')
    },
    async signIn(email, password) { return result(client.auth.signInWithPassword({ email, password })) },
    async signUp(email, password, callbackUrl) { return result(client.auth.signUp({ email, password, options: { emailRedirectTo: callbackUrl } })) },
    async reset(email, callbackUrl) { return result(client.auth.resetPasswordForEmail(email, { redirectTo: callbackUrl })) },
    async resend(email, callbackUrl) { return result(client.auth.resend({ type: 'signup', email, options: { emailRedirectTo: callbackUrl } })) },
    async confirmEmail(confirmation) {
      if(!confirmation||!['email','recovery'].includes(confirmation.type))throw new Error('验证链接无效')
      const wasRecovery=recovery; recovery=confirmation.type==='recovery'
      try{return await result(client.auth.verifyOtp(confirmation))}catch(error){recovery=wasRecovery;throw error}
    },
    async updatePassword(password) { if (!recovery || !session) throw new Error('请先从重设邮件验证身份'); const data = await result(client.auth.updateUser({ password })); recovery = false; changed({ user: session.user, recovery: false, identityChanged: false }); return data },
    async signOut() {
      storage.lock() // Freeze writes before invalidating credentials or replacing the view.
      try { await result(client.auth.signOut({ scope: 'local' })); apply(null, 'SIGNED_OUT') }
      catch (error) { storage.setOwner(session?.user?.id ?? null); throw error }
    },
    async forgetDeleted(expectedId) {
      if (session?.user?.id !== expectedId) throw new Error('账号已变化，未清理其它身份')
      storage.lock()
      try { await client.auth.signOut({ scope: 'local' }) }
      finally { apply(null, 'SIGNED_OUT') } // Never restore a successfully deleted owner on network failure.
    },
    dispose() { subscription.unsubscribe() },
  }
}
let promise
export async function confirmPendingEmail() {
  const confirmation=emailConfirmation
  emailConfirmation=null // No automatic or repeated redemption, including on failure.
  if(!confirmation)throw new Error('验证链接已使用或无效，请重新发送邮件')
  const auth=await initAuth()
  if(!auth)throw new Error('账号服务尚未开放')
  return auth.confirmEmail(confirmation)
}
export function initAuth() {
  if (promise) return promise
  if (!multiuserConfig.auth || typeof window === 'undefined') return Promise.resolve(null)
  promise = (async () => {
    const { createClient } = await import('./supabase-browser.mjs')
    const client = createClient(multiuserConfig.supabaseUrl, multiuserConfig.publishableKey, { auth: {
      flowType: 'pkce', detectSessionInUrl: true, autoRefreshToken: true, persistSession: true,
      ...tabAuthStorage(window.sessionStorage),
    } })
    const auth = createAuthClient({ client, storage: getStudyStorage(), initialRecovery: window.sessionStorage.getItem('zhixu-recovery-v1') === '1', invalidated: () => {
      client.auth.stopAutoRefresh()
      clearTabAuthStorage(window.sessionStorage)
    }, changed: detail => {
      if (!detail.user) for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
        const key = window.sessionStorage.key(i)
        if (key?.startsWith('zhixu-auth-v1')) window.sessionStorage.removeItem(key)
      }
      detail.recovery ? window.sessionStorage.setItem('zhixu-recovery-v1','1') : window.sessionStorage.removeItem('zhixu-recovery-v1')
      window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail }))
      // Clear every module's in-memory drafts and answers on actual account changes.
      if (detail.identityChanged) window.location.reload()
    } })
    try { await auth.init() }
    catch (error) { const before = getStudyStorage().owner; getStudyStorage().setOwner(null); auth.dispose(); promise = null; if(before)window.location.reload(); throw error }
    const url = new URL(window.location.href)
    for (const key of ['code','error','error_description']) url.searchParams.delete(key)
    if (window.location.search !== url.search) history.replaceState(history.state, '', url.pathname + url.search + url.hash)
    return auth
  })()
  return promise
}
