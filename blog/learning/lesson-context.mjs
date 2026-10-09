import { studyIdentity } from './study-state.mjs'
export function sanitizeSelection(value) {
  return String(value ?? '').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[邮箱已隐藏]')
    .replace(/(?:Bearer\s+|sk-)[a-zA-Z0-9._-]{10,}/g, '[凭据已隐藏]').slice(0, 1500)
}
export function lessonContext({ document, location, selection = '', base = '/blog/' }) {
  const identity = studyIdentity(location.pathname, base)
  if (!identity) return null
  const selected = document?.getSelection?.()
  const anchor = selected?.anchorNode?.parentElement
  if (anchor?.closest('input,textarea,[contenteditable],.zhixu-account-dialog,.zhixu-ai-panel')) selection = ''
  else if (!selection) selection = selected?.toString?.() || ''
  return { lessonKey: identity.key, section: (location.hash || '').slice(1,121), selectedText: sanitizeSelection(selection), sourcePath: location.pathname }
}
