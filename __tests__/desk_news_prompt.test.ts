/**
 * Desk News Agent must stay an event desk.
 * Run: npx tsx __tests__/desk_news_prompt.test.ts
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DESK_NEWS_AGENT_PROMPT, buildDeskNewsSystemPrompt } from '../lib/trading/deskNewsPrompt'

const prompt = DESK_NEWS_AGENT_PROMPT
const route = readFileSync(new URL('../app/api/trading/news-ai/route.ts', import.meta.url), 'utf8')

assert.match(prompt, /DESK_NEWS_AGENT/)
assert.match(prompt, /YM, NQ, NKD, GC, and CL/)
assert.match(prompt, /OIL_AGENT, GOLD_AGENT, NQ_AGENT, DOW_AGENT, NIKKEI_AGENT/)
assert.match(prompt, /UPCOMING CALENDAR DATA UNAVAILABLE/)
assert.match(prompt, /NO VERIFIED TIER-1 EVENT IN CURRENT CALENDAR WINDOW/)
assert.match(prompt, /EXPECTED MARKET SENSITIVITY/)
assert.match(prompt, /PENDING_REACTION_ENGINE/)
assert.match(prompt, /TSE_CASH_SESSION/)
assert.match(prompt, /OSE_FUTURES_SESSION/)
assert.match(prompt, /09:00–11:30 JST/)
assert.match(prompt, /12:30–15:30 JST/)
assert.match(prompt, /LATEST AVAILABLE QUOTE/)
assert.match(prompt, /JPY_INTERVENTION_RISK/)

assert.doesNotMatch(prompt, /support or resistance levels[\s\S]*MUST be grounded/i)
assert.doesNotMatch(prompt, /NEVER state that there are no news/)
assert.match(prompt, /Do not invent an exact expected volatility level/)
assert.doesNotMatch(prompt, /with exact expected volatility levels/)
assert.match(prompt, /Do not use a fixed USDJPY level/)
assert.doesNotMatch(prompt, /intervention territory/)
assert.doesNotMatch(prompt, /LIVE REAL-TIME/)
assert.doesNotMatch(prompt, /09:00–15:00/)
assert.doesNotMatch(prompt, /Leo Macro/)

assert.doesNotMatch(route, /FALLBACK_HIGH_IMPACT_CALENDAR/)
assert.doesNotMatch(route, /LIVE REAL-TIME/)
assert.doesNotMatch(route, /Support:/)
assert.match(route, /buildDeskNewsSystemPrompt/)
assert.match(route, /LATEST AVAILABLE QUOTE/)
assert.match(route, /formatQuoteForPrompt\('YM', 'MYM'/)
assert.match(route, /formatQuoteForPrompt\('NQ', 'MNQ'/)
assert.match(route, /formatQuoteForPrompt\('GC', 'MGC'/)
assert.match(route, /formatQuoteForPrompt\('CL', 'MCL'/)

const assembled = buildDeskNewsSystemPrompt('CONTEXT_BLOCK')
assert.match(assembled, /CONTEXT_BLOCK/)
assert.match(assembled, /DESK_NEWS_AGENT/)

console.log('desk_news_prompt: event-desk contract holds')
