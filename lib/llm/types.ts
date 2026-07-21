export type LlmProvider = 'anthropic' | 'gemini' | 'openai'

export type LlmUsage = {
  provider: LlmProvider
  model: string
  input_tokens: number
  output_tokens: number
  role: 'proposer' | 'verifier'
}

export type LlmCompleteRequest = {
  provider: LlmProvider
  model: string
  system: string
  user: string
  maxTokens?: number
  temperature?: number
}

export type LlmCompleteResult = {
  text: string
  usage: LlmUsage
}
