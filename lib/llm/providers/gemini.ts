import type { LlmCompleteRequest, LlmCompleteResult } from '@/lib/llm/types'

/**
 * Gemini REST generateContent (no extra SDK required).
 * Docs: https://ai.google.dev/api/generate-content
 */
export async function completeGemini(
  req: LlmCompleteRequest,
  signal?: AbortSignal
): Promise<LlmCompleteResult> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY not set')

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    req.model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`

  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.user }] }],
      generationConfig: {
        temperature: req.temperature ?? 0.1,
        maxOutputTokens: req.maxTokens ?? 512,
        responseMimeType: 'application/json',
      },
    }),
  })

  const json = await res.json().catch(() => null)
  if (!res.ok) {
    const msg = json?.error?.message || `Gemini HTTP ${res.status}`
    throw new Error(msg)
  }

  const text =
    json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') ||
    ''

  if (!text.trim()) {
    throw new Error('Empty Gemini response')
  }

  const usageMeta = json?.usageMetadata || {}
  return {
    text,
    usage: {
      provider: 'gemini',
      model: req.model,
      role: 'verifier',
      input_tokens: Number(usageMeta.promptTokenCount || 0),
      output_tokens: Number(usageMeta.candidatesTokenCount || usageMeta.totalTokenCount || 0),
    },
  }
}
