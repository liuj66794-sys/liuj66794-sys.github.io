// Consume once into memory, never sessionStorage or learning backups.
export function consumeEmailConfirmation(location, history, callbackUrl) {
  const url=new URL(location.href), params=new URLSearchParams(url.hash.slice(1))
  if(!params.has('token_hash'))return null
  const token=params.get('token_hash'),type=params.get('type')
  history.replaceState(history.state,'',url.pathname+url.search)
  let callback
  try{callback=new URL(callbackUrl)}catch{return null}
  if(url.origin!==callback.origin||url.pathname!==callback.pathname
    ||!['email','recovery'].includes(type)||!/^[a-f0-9]{64}$/i.test(token||''))return null
  return {token_hash:token,type}
}
