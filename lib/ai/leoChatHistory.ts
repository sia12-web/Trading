/**
 * Persist Leo chat per instrument + paper/live so refresh / leaving the desk
 * still lets the trader review the conversation.
 */

import type { LeoMessage } from '@/lib/ai/leoAssistant'

export const LEO_CHAT_STORAGE_KEY = 'tradepulse.leo.chat.v1'
/** Keep recent turns only — enough to review, small enough for localStorage. */
export const LEO_CHAT_MAX_MESSAGES = 80

export function leoChatHistoryKey(instrument: string, paperMode: boolean): string {
  return `${instrument}:${paperMode ? 'paper' : 'live'}`
}

function stripForStorage(messages: LeoMessage[]): LeoMessage[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    timestamp: m.timestamp,
    // Drop bulky attached chart payloads; keep text so the thread is reviewable.
  }))
}

export function trimLeoChatHistory(messages: LeoMessage[], max = LEO_CHAT_MAX_MESSAGES): LeoMessage[] {
  if (messages.length <= max) return messages
  const welcome = messages.find((m) => m.id.startsWith('welcome-'))
  const rest = messages.filter((m) => m !== welcome)
  const kept = rest.slice(-(max - (welcome ? 1 : 0)))
  return welcome ? [welcome, ...kept] : kept
}

export function loadAllLeoChatHistory(): Record<string, LeoMessage[]> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(LEO_CHAT_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, LeoMessage[]>
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, LeoMessage[]> = {}
    for (const [key, rows] of Object.entries(parsed)) {
      if (!Array.isArray(rows)) continue
      out[key] = trimLeoChatHistory(
        rows.filter(
          (m) =>
            m &&
            typeof m.id === 'string' &&
            (m.role === 'user' || m.role === 'assistant') &&
            typeof m.content === 'string'
        )
      )
    }
    return out
  } catch {
    return {}
  }
}

export function loadLeoChatHistory(instrument: string, paperMode: boolean): LeoMessage[] | null {
  const all = loadAllLeoChatHistory()
  const rows = all[leoChatHistoryKey(instrument, paperMode)]
  return rows && rows.length > 0 ? rows : null
}

export function saveLeoChatHistory(
  instrument: string,
  paperMode: boolean,
  messages: LeoMessage[]
): void {
  if (typeof window === 'undefined') return
  const key = leoChatHistoryKey(instrument, paperMode)
  const trimmed = trimLeoChatHistory(stripForStorage(messages))
  try {
    const all = loadAllLeoChatHistory()
    all[key] = trimmed
    localStorage.setItem(LEO_CHAT_STORAGE_KEY, JSON.stringify(all))
  } catch {
    /* private mode / quota */
  }
}

export function clearLeoChatHistory(instrument: string, paperMode: boolean): void {
  if (typeof window === 'undefined') return
  const key = leoChatHistoryKey(instrument, paperMode)
  try {
    const all = loadAllLeoChatHistory()
    delete all[key]
    localStorage.setItem(LEO_CHAT_STORAGE_KEY, JSON.stringify(all))
  } catch {
    /* ignore */
  }
}
