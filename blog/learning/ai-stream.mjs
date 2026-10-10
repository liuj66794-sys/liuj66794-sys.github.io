// SSE frames are untrusted data, never code or HTML. Bound total and frame sizes.
export async function* readAIEvents(stream, {maxBytes=250000,signal}={}) {
  if(!stream)throw new Error('missing_stream')
  const reader=stream.getReader(),decoder=new TextDecoder();let buffer='',bytes=0
  try{
    for(;;){
      if(signal?.aborted)throw new DOMException('已取消','AbortError')
      const {done,value}=await reader.read()
      if(done)break
      bytes+=value.byteLength;if(bytes>maxBytes)throw new Error('stream_too_large')
      buffer+=decoder.decode(value,{stream:true}).replace(/\r/g,'')
      let end
      while((end=buffer.indexOf('\n\n'))>=0){
        const frame=buffer.slice(0,end);buffer=buffer.slice(end+2)
        const data=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n')
        if(data)yield data
      }
      if(buffer.length>65536)throw new Error('stream_frame_too_large')
    }
    buffer+=decoder.decode()
    if(buffer.trim())throw new Error('incomplete_stream_frame')
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
}
