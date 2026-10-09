import { getStudyStorage } from './study-storage.mjs'
// A guided section has its own practice round; original exam-answer identities stay intact.
export const GUIDED_PREFIX = 'l1uj-guided-v1:'
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
const safeId = value => typeof value === 'string' && /^[a-z0-9-]{1,80}$/.test(value)
export const guideKey = (slug, lesson, section) => `${GUIDED_PREFIX}${slug}:${lesson}:${section}`
export const guideSignature = guide => JSON.stringify([guide.revision, guide.steps.map(s => [s.id, s.question ?? s.reflection ?? null])])

export function validGuideState(value) {
  if (!plain(value) || value.version !== 1 || typeof value.signature !== 'string' || value.signature.length > 80000) return false
  if (Object.keys(value).some(k => !['version', 'signature', 'step', 'answers', 'note', 'recall', 'updatedAt', 'round', 'drafts'].includes(k))) return false
  if (value.drafts !== undefined && (!plain(value.drafts) || Object.keys(value.drafts).length > 100 || !Object.entries(value.drafts).every(([id, draft]) => safeId(id) && typeof draft === 'string' && draft.length <= 6000))) return false
  if (!Number.isInteger(value.step) || value.step < 0 || value.step > 100 || !Number.isInteger(value.round) || value.round < 1) return false
  if (!Number.isFinite(value.updatedAt) || value.updatedAt < 0 || !plain(value.answers) || Object.keys(value.answers).length > 100) return false
  if (typeof value.note !== 'string' || value.note.length > 2000 || typeof value.recall !== 'string' || value.recall.length > 2000) return false
  return Object.entries(value.answers).every(([id, a]) => safeId(id) && plain(a)
    && Object.keys(a).every(k => ['picked', 'hinted', 'revealed'].includes(k))
    && (a.picked === null || (Number.isInteger(a.picked) && a.picked >= 0 && a.picked < 20))
    && typeof a.hinted === 'boolean' && typeof a.revealed === 'boolean'
    && (!a.revealed || a.picked === null))
}

export function freshGuideState(guide) {
  return { version: 1, signature: guideSignature(guide), step: 0, answers: {}, note: '', recall: '', updatedAt: 0, round: 1 }
}

export function readGuideState(guide, key, storage) {
  const fresh = freshGuideState(guide)
  try {
    const saved = JSON.parse((storage || getStudyStorage()).getItem(key) || 'null')
    if (!validGuideState(saved) || saved.signature !== fresh.signature) return fresh
    const answers = {}
    for (const step of guide.steps) {
      const a = saved.answers[step.id]
      if (step.question && a && (a.picked === null || a.picked < step.question.options.length)) answers[step.id] = a
    }
    return { ...saved, step: Math.min(saved.step, guide.steps.length), answers }
  } catch { return fresh }
}

export function saveGuideState(key, state, storage, now = Date.now()) {
  state.updatedAt = now
  try {
    if (!validGuideState(state)) return false
    ;(storage || getStudyStorage()).setItem(key, JSON.stringify(state))
    return true
  } catch { return false }
}

// Once checked or revealed, an answer stays fixed for this round, including after refresh.
export function answerGuide(state, step, picked) {
  const old = state.answers[step.id]
  if (!step.question || old?.picked != null || old?.revealed || !Number.isInteger(picked) || !step.question.options[picked]) return state
  return { ...state, answers: { ...state.answers, [step.id]: { picked, hinted: old?.hinted || false, revealed: false } } }
}

export function guideResults(guide, state) {
  const result = { total: guide.steps.filter(s => s.question).length, answered: 0, correct: 0, independent: 0, revealed: 0, transferCorrect: 0, transferTotal: 0 }
  for (const step of guide.steps) {
    if (!step.question) continue
    const a = state.answers[step.id]
    if (step.transfer) result.transferTotal++
    if (a?.revealed) result.revealed++
    if (a?.picked == null) continue
    result.answered++
    if (a.picked !== step.question.answer) continue
    result.correct++
    if (!a.hinted && !a.revealed) {
      result.independent++
      if (step.transfer) result.transferCorrect++
    }
  }
  return result
}

export function validateGuide(guide) {
  const errors = []
  if (!guide || guide.revision !== 1 || !guide.title || !Array.isArray(guide.steps) || !guide.steps.length) return ['引导小节缺少 revision/title/steps']
  const seen = new Set()
  for (const step of guide.steps) {
    if (!safeId(step.id) || seen.has(step.id)) errors.push('步骤 id 缺失或重复')
    seen.add(step.id)
    const q = step.question
    if (!q) {
      if (!step.title || !Array.isArray(step.body) || !step.body.length || !step.reflection) errors.push(`${step.id} 缺少讲解或回忆任务`)
      continue
    }
    if (!step.title || !Array.isArray(step.body) || !step.body.length || !q?.stem || !q.hint || !Array.isArray(q.steps) || !q.steps.length) errors.push(`${step.id} 缺讲解或判断步骤`)
    if (!Array.isArray(q?.options) || q.options.length < 2 || !Number.isInteger(q.answer) || !q.options[q.answer]) errors.push(`${step.id} 答案越界`)
    if (!q?.options?.every(o => o.text && o.why)) errors.push(`${step.id} 缺逐选项解析`)
  }
  return errors
}
