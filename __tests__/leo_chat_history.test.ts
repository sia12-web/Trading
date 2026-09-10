import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  LEO_CHAT_STORAGE_KEY,
  leoChatHistoryKey,
  loadLeoChatHistory,
  saveLeoChatHistory,
  clearLeoChatHistory,
  trimLeoChatHistory,
} from '../lib/ai/leoChatHistory'
import type { LeoMessage } from '../lib/ai/leoAssistant'

describe('Leo chat localStorage persistence', () => {
  it('saves and reloads per instrument + paper/live', () => {
    // jsdom-less: shim localStorage
    const store = new Map<string, string>()
    const ls = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
    }
    ;(globalThis as any).localStorage = ls
    ;(globalThis as any).window = globalThis

    clearLeoChatHistory('DOW', true)
    const msgs: LeoMessage[] = [
      { id: 'welcome-DOW', role: 'assistant', content: 'hi', timestamp: 1 },
      { id: 'u1', role: 'user', content: 'go long', timestamp: 2 },
      { id: 'a1', role: 'assistant', content: 'placed', timestamp: 3 },
    ]
    saveLeoChatHistory('DOW', true, msgs)
    assert.equal(leoChatHistoryKey('DOW', true), 'DOW:paper')
    const loaded = loadLeoChatHistory('DOW', true)
    assert.ok(loaded)
    assert.equal(loaded!.length, 3)
    assert.equal(loaded![1]!.content, 'go long')
    assert.equal(loadLeoChatHistory('DOW', false), null)
    clearLeoChatHistory('DOW', true)
    assert.equal(loadLeoChatHistory('DOW', true), null)
  })

  it('trims long threads but keeps welcome', () => {
    const rows: LeoMessage[] = [
      { id: 'welcome-GOLD', role: 'assistant', content: 'w', timestamp: 0 },
      ...Array.from({ length: 100 }, (_, i) => ({
        id: `m${i}`,
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `c${i}`,
        timestamp: i + 1,
      })),
    ]
    const trimmed = trimLeoChatHistory(rows, 20)
    assert.ok(trimmed.length <= 20)
    assert.equal(trimmed[0]!.id, 'welcome-GOLD')
  })
})
