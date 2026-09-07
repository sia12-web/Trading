export type LevelType = 'support' | 'resistance' | 'vwap'
export type Timeframe = 'D' | '4H' | 'H1' | 'M5'

export type LevelIdentification = {
  id?: string
  level: number
  type: LevelType
  conviction: number
  reasoning: string
  timeframe: Timeframe
  source?: string
}

export type IdentifiedLevel = LevelIdentification

export type LevelHistory = {
  id: string
  user_id: string
  session_id: string
  instrument: string
  level: number
  type: LevelType
  conviction: number
  reasoning: string
  timeframe: Timeframe
  tested_count: number
  success_count: number
  last_tested_date: string | null
  created_at?: string
}

export type ArchiveRequest = {
  session_id: string
  instrument: string
  levels: LevelIdentification[]
}

export type ArchiveResponse = {
  archived_count: number
  duplicate_count: number
  level_history_ids: string[]
}

export type HistoryResponse = {
  levels: LevelHistory[]
  count?: number
  total_count?: number
  instrument?: string
  days?: number
  query_params?: {
    instrument: string
    days: number
    limit: number
  }
}
