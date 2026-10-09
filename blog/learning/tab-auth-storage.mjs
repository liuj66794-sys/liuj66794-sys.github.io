// Supabase broadcasts auth events by storageKey even with sessionStorage.
// Use a document-unique channel while mapping SDK persistence/PKCE keys back to
// this tab's stable sessionStorage key. No per-user data or tokens in channels.
export function clearTabAuthStorage(session) {
  for(let i=session.length-1;i>=0;i--){
    const key=session.key(i)
    if(key==='zhixu-auth-v1'||key?.startsWith('zhixu-auth-v1-')||key==='zhixu-active-owner-v1'||key==='zhixu-recovery-v1')session.removeItem(key)
  }
}
export function tabAuthStorage(session, channel = 'zhixu-auth-document-' + crypto.randomUUID()) {
  const key = name => {
    if (name !== channel && !name.startsWith(channel + '-')) throw new Error('非当前身份存储键')
    return 'zhixu-auth-v1' + name.slice(channel.length)
  }
  return { storageKey: channel, storage: {
    getItem: name => session.getItem(key(name)),
    setItem: (name, value) => session.setItem(key(name), value),
    removeItem: name => session.removeItem(key(name)),
  } }
}
