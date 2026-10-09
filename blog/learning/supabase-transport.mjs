export function createSupabaseTransport(client) {
  return {
    async push(item, signal) {
      const { data, error } = await client.rpc('sync_study', { p_request_id: item.request_id, p_bucket: item.bucket, p_record_id: item.record_id, p_payload: item.payload,
        p_base_revision: item.base_revision, p_deleted: item.deleted }).abortSignal(signal)
      if (error) throw new Error('同步写入失败')
      return data
    },
    async pull(cursor, signal) {
      // Paginate by monotonic server sequence, never by client timestamps.
      const all = []
      for (;;) {
        const { data, error } = await client.from('study_records').select('*').gt('change_seq', cursor).order('change_seq').limit(200).abortSignal(signal)
        if (error) throw new Error('同步读取失败')
        all.push(...data)
        if (data.length < 200) return all
        cursor = data.at(-1).change_seq
      }
    },
  }
}
