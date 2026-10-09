import { readAIEvents } from './ai-stream.mjs'
export function createAITutorClient({ endpoint, auth, publishableKey='', fetcher = fetch }) {
  let controller
  async function ask(input,{onDelta=()=>{}}={}) {
    if (!auth.session?.access_token) throw new Error('请先登录')
    controller?.abort(); controller = new AbortController()
    const active=controller
    const timeout = setTimeout(() => active.abort(), 40000)
    try {
      const response = await fetcher(endpoint, { method: 'POST', signal: active.signal, headers: { 'Content-Type': 'application/json', Accept:'text/event-stream', Authorization: `Bearer ${auth.session.access_token}`,...(publishableKey?{apikey:publishableKey}:{}) },
        body: JSON.stringify({ ...input, requestId: crypto.randomUUID() }) })
      if (!response.ok) throw new Error(response.status === 429 ? '今日额度已用完或请求过快，请稍后重试' : 'AI 暂不可用，公开课程与作答不受影响')
      let result,partial=''
      if(response.headers.get('content-type')?.includes('text/event-stream')){
        for await(const data of readAIEvents(response.body,{signal:active.signal})){
          const frame=JSON.parse(data)
          if(frame.type==='error')throw new Error('AI 回答中断，请重试；本课作答不受影响')
          if(frame.type==='delta'){
            if(typeof frame.text!=='string')throw new Error('AI 返回格式异常')
            partial+=frame.text;if(partial.length>20000)throw new Error('AI 回答过长')
            onDelta(partial)
          }else if(frame.type==='complete'){result=frame;break}
        }
        if(!result)throw new Error('AI 回答中断，请重试；本课作答不受影响')
      }else result = await response.json()
      if (typeof result.answer !== 'string' || result.answer.length > 20000 || !Array.isArray(result.sources)) throw new Error('AI 返回格式异常')
      return result
    } finally { clearTimeout(timeout) }
  }
  return { ask, cancel: () => controller?.abort(),
    async conversations() { const { data, error } = await auth.client.from('ai_conversations').select('*').order('created_at', { ascending: false }); if (error) throw new Error('会话读取失败'); return data },
    async messages(id) {
      const owner=auth.session?.user?.id,rows=[],seen=new Set();let total
      if(!owner)throw new Error('请先登录')
      for(let offset=0;;offset+=100){
        if(auth.session?.user?.id!==owner)throw new Error('账号已变化，请重新读取会话')
        const {data,error,count}=await auth.client.from('ai_messages').select('id,user_id,role,content,sources,created_at',{count:'exact'})
          // now() is transaction-stable: bulk question/answer timestamps tie.
          // Stable role DESC puts user before assistant, then UUID breaks ties.
          .eq('conversation_id',id).order('created_at',{ascending:true}).order('role',{ascending:false}).order('id',{ascending:true}).range(offset,offset+99)
        if(error||!Array.isArray(data)||!Number.isInteger(count))throw new Error('会话读取失败，没有返回截断的历史')
        total??=count
        if(count!==total||total>5000||auth.session?.user?.id!==owner)throw new Error('会话变化或超过上限，请分批查看或导出全部数据')
        for(const row of data){if(row.user_id!==owner||seen.has(row.id))throw new Error('会话归属或分页变化，请重新读取');seen.add(row.id);rows.push(row)}
        if(JSON.stringify(rows).length>10000000)throw new Error('会话过大，请导出全部数据')
        if(rows.length===total)return rows
        if(data.length!==100||rows.length>total)throw new Error('会话变化，请重新读取，未返回部分历史')
      }
    },
    async removeConversation(id) { const { error } = await auth.client.from('ai_conversations').delete().eq('id',id); if (error) throw new Error('会话删除失败') },
  }
}
