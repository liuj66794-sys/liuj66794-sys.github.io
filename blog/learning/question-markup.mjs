const inlineTags = { b: 'strong', strong: 'strong', u: 'u', i: 'em', em: 'em', sub: 'sub', sup: 'sup', s: 's', del: 's', mark: 'mark' }
const ignoredTags = new Set(['script', 'style', 'template', 'iframe', 'object', 'svg', 'math'])

export const escapeMarkup = text => String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Shared by the build-time HTML parser and browser DOM. Only fixed inline tags
// survive; attributes, URLs, event handlers and authored CSS never reach review HTML.
export function serializeQuestionMarkup(node, reader) {
  if (!node) return ''
  const text = reader.text(node)
  if (text != null) return escapeMarkup(text)
  const tag = reader.tag(node)
  const classes = reader.attr(node, 'class').split(/\s+/)
  if (ignoredTags.has(tag) || classes.some(c => ['quiz-flag', 'qno', 'mtag'].includes(c))) return ''
  if (tag === 'br') return '<br>'
  let result = reader.children(node).map(child => serializeQuestionMarkup(child, reader)).join('')
  const wrappers = new Set(Object.hasOwn(inlineTags, tag) ? [inlineTags[tag]] : [])
  for (const declaration of reader.attr(node, 'style').split(';')) {
    const [property, raw = ''] = declaration.split(':')
    const value = raw.trim().toLowerCase().replace(/\s*!important$/, '')
    const name = property.trim().toLowerCase()
    if (['text-decoration', 'text-decoration-line'].includes(name) && /\bunderline\b/.test(value)) wrappers.add('u')
    if (name === 'font-weight' && (/^(bold|bolder)$/.test(value) || /^[6-9]00$/.test(value))) wrappers.add('strong')
    if (name === 'font-style' && /^(italic|oblique)$/.test(value)) wrappers.add('em')
  }
  for (const wrapper of wrappers) result = `<${wrapper}>${result}</${wrapper}>`
  return result
}
