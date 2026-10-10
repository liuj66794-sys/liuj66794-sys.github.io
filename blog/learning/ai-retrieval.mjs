const stop = new Set(['什么','怎么','这个','一下','解释','课程','如何','为什么','the','and','what','how','this','with'])
export function queryTokens(text) {
  const latin = (text.toLowerCase().match(/[a-z][a-z0-9_+-]{1,}/g) || []).filter(x => !stop.has(x))
  const chinese = (text.match(/[\u4e00-\u9fff]{2,}/g) || []).flatMap(word => Array.from({ length: word.length - 1 }, (_, i) => word.slice(i, i + 2))).filter(x => !stop.has(x))
  return [...new Set([...latin, ...chinese])]
}
export function retrieveSources(index, { question, lessonKey, section = '', limit = 4 }) {
  const tokens = queryTokens(question)
  if (!tokens.length) return []
  return index.filter(chunk => chunk.lessonKey === lessonKey).map(chunk => {
    const text = chunk.text.toLowerCase(), heading = chunk.heading.toLowerCase()
    const matched = tokens.filter(token => text.includes(token))
    const score = matched.length * 2 + matched.filter(token => heading.includes(token)).length * 3 + (chunk.section === section && section ? 2 : 0)
    return { chunk, matched, score }
  }).filter(entry => entry.matched.length >= Math.min(2, tokens.length))
    .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id)).slice(0, limit).map(x => x.chunk)
}
export function filterCitations(ids, sources) {
  const known = new Map(sources.map(s => [s.id, s]))
  return [...new Set(Array.isArray(ids) ? ids : [])].filter(id => known.has(id)).map(id => {
    const { text, ...citation } = known.get(id)
    return citation
  })
}
