// Database type definitions for trading application
// Auto-generated from Supabase schema

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      sessions: {
        Row: {
          id: string
          user_id: string
          date: string
          index_recommendation: 'DOW' | 'NASDAQ'
          prep_notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          date: string
          index_recommendation: 'DOW' | 'NASDAQ'
          prep_notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          date?: string
          index_recommendation?: 'DOW' | 'NASDAQ'
          prep_notes?: string | null
          created_at?: string
        }
      }
      identified_levels: {
        Row: {
          id: string
          session_id: string
          user_id: string
          level: number
          type: 'support' | 'resistance' | 'vwap'
          conviction: number
          reasoning: string
          timeframe: 'D' | '4H' | 'H1'
          created_at: string
        }
        Insert: {
          id?: string
          session_id: string
          user_id: string
          level: number
          type: 'support' | 'resistance' | 'vwap'
          conviction: number
          reasoning: string
          timeframe: 'D' | '4H' | 'H1'
          created_at?: string
        }
        Update: {
          id?: string
          session_id?: string
          user_id?: string
          level?: number
          type?: 'support' | 'resistance' | 'vwap'
          conviction?: number
          reasoning?: string
          timeframe?: 'D' | '4H' | 'H1'
          created_at?: string
        }
      }
      level_history: {
        Row: {
          id: string
          user_id: string
          session_id: string
          instrument: 'DOW' | 'NASDAQ' | 'NIKKEI'
          level: number
          type: 'support' | 'resistance' | 'vwap'
          conviction: number
          reasoning: string
          timeframe: 'D' | '4H' | 'H1'
          tested_count: number
          success_count: number
          last_tested_date: string | null
          created_at: string
          archived_at: string
        }
        Insert: {
          id?: string
          user_id: string
          session_id: string
          instrument: 'DOW' | 'NASDAQ' | 'NIKKEI'
          level: number
          type: 'support' | 'resistance' | 'vwap'
          conviction: number
          reasoning: string
          timeframe: 'D' | '4H' | 'H1'
          tested_count?: number
          success_count?: number
          last_tested_date?: string | null
          created_at?: string
          archived_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          session_id?: string
          instrument?: 'DOW' | 'NASDAQ' | 'NIKKEI'
          level?: number
          type?: 'support' | 'resistance' | 'vwap'
          conviction?: number
          reasoning?: string
          timeframe?: 'D' | '4H' | 'H1'
          tested_count?: number
          success_count?: number
          last_tested_date?: string | null
          created_at?: string
          archived_at?: string
        }
      }
      positions: {
        Row: {
          id: string
          user_id: string
          session_id: string
          symbol: string
          side: 'BUY' | 'SHORT'
          entry_level: number
          stop_loss: number
          take_profit: number
          entry_price: number | null
          exit_price: number | null
          quantity: number
          status: 'open' | 'closed'
          pnl_pips: number | null
          pnl_dollars: number | null
          is_paper_trading: boolean
          created_at: string
          closed_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          session_id: string
          symbol: string
          side: 'BUY' | 'SHORT'
          entry_level: number
          stop_loss: number
          take_profit: number
          entry_price?: number | null
          exit_price?: number | null
          quantity: number
          status?: 'open' | 'closed'
          pnl_pips?: number | null
          pnl_dollars?: number | null
          is_paper_trading?: boolean
          created_at?: string
          closed_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          session_id?: string
          symbol?: string
          side?: 'BUY' | 'SHORT'
          entry_level?: number
          stop_loss?: number
          take_profit?: number
          entry_price?: number | null
          exit_price?: number | null
          quantity?: number
          status?: 'open' | 'closed'
          pnl_pips?: number | null
          pnl_dollars?: number | null
          is_paper_trading?: boolean
          created_at?: string
          closed_at?: string | null
        }
      }
      monitoring_events: {
        Row: {
          id: string
          position_id: string
          event_type: 'alert' | 'execution' | 'simulated_execution' | 'closed'
          price: number | null
          description: string
          created_at: string
        }
        Insert: {
          id?: string
          position_id: string
          event_type: 'alert' | 'execution' | 'simulated_execution' | 'closed'
          price?: number | null
          description: string
          created_at?: string
        }
        Update: {
          id?: string
          position_id?: string
          event_type?: 'alert' | 'execution' | 'simulated_execution' | 'closed'
          price?: number | null
          description?: string
          created_at?: string
        }
      }
      price_data: {
        Row: {
          id: string
          symbol: string
          timeframe: 'M5' | 'H1' | 'H4'
          open: number
          high: number
          low: number
          close: number
          volume: number
          rvol: number | null
          timestamp: string
          created_at: string
        }
        Insert: {
          id?: string
          symbol: string
          timeframe: 'M5' | 'H1' | 'H4'
          open: number
          high: number
          low: number
          close: number
          volume: number
          rvol?: number | null
          timestamp: string
          created_at?: string
        }
        Update: {
          id?: string
          symbol?: string
          timeframe?: 'M5' | 'H1' | 'H4'
          open?: number
          high?: number
          low?: number
          close?: number
          volume?: number
          rvol?: number | null
          timestamp?: string
          created_at?: string
        }
      }
      news_events: {
        Row: {
          id: string
          headline: string
          summary: string
          source: string
          sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'
          relevance: 'DOW' | 'NASDAQ' | 'NIKKEI' | 'MACRO'
          url: string | null
          published_at: string
          created_at: string
        }
        Insert: {
          id?: string
          headline: string
          summary: string
          source: string
          sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'
          relevance: 'DOW' | 'NASDAQ' | 'NIKKEI' | 'MACRO'
          url?: string | null
          published_at: string
          created_at?: string
        }
        Update: {
          id?: string
          headline?: string
          summary?: string
          source?: string
          sentiment?: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'
          relevance?: 'DOW' | 'NASDAQ' | 'NIKKEI' | 'MACRO'
          url?: string | null
          published_at?: string
          created_at?: string
        }
      }
      profiles: {
        Row: {
          id: string
          email: string | null
          trading_mode: 'paper' | 'live'
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email?: string | null
          trading_mode?: 'paper' | 'live'
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string | null
          trading_mode?: 'paper' | 'live'
          created_at?: string
          updated_at?: string
        }
      }
      level_breaks: {
        Row: {
          id: string
          instrument: 'DOW' | 'NASDAQ' | 'NIKKEI'
          level: number
          direction: 'up' | 'down'
          confidence: number
          entry_price: number
          break_price: number
          volume: number | null
          reasoning: string
          score_breakdown: Json
          break_timestamp: string
          created_at: string
        }
        Insert: {
          id?: string
          instrument: 'DOW' | 'NASDAQ' | 'NIKKEI'
          level: number
          direction: 'up' | 'down'
          confidence: number
          entry_price: number
          break_price: number
          volume?: number | null
          reasoning: string
          score_breakdown: Json
          break_timestamp: string
          created_at?: string
        }
        Update: {
          id?: string
          instrument?: 'DOW' | 'NASDAQ' | 'NIKKEI'
          level?: number
          direction?: 'up' | 'down'
          confidence?: number
          entry_price?: number
          break_price?: number
          volume?: number | null
          reasoning?: string
          score_breakdown?: Json
          break_timestamp?: string
          created_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// Additional type exports for API usage
export type TradingMode = 'paper' | 'live'
export type TradeStatus = 'open' | 'closed'
export type TradeDirection = 'BUY' | 'SHORT'
export type LevelType = 'support' | 'resistance' | 'vwap'
export type Sentiment = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'
export type Relevance = 'DOW' | 'NASDAQ' | 'NIKKEI' | 'MACRO'

// API Request/Response types
export interface TradingModeResponse {
  trading_mode: TradingMode
  is_live_trading_enabled: boolean
  updated_at?: string
}

export interface UpdateTradingModeRequest {
  mode: TradingMode
}

export interface PositionCreateRequest {
  session_id: string
  symbol: string
  side: TradeDirection
  entry_level: number
  stop_loss: number
  take_profit: number
  quantity: number
}

export interface SessionCreateRequest {
  date: string
  index_recommendation: 'DOW' | 'NASDAQ'
  prep_notes?: string
}

// Level Break types (Slice 3)
export interface LevelBreak {
  id: string
  instrument: 'DOW' | 'NASDAQ' | 'NIKKEI'
  level: number
  direction: 'up' | 'down'
  confidence: number
  entryPrice: number
  breakPrice: number
  volume?: number | null
  reasoning: string
  scoreBreakdown: Record<string, unknown>
  breakTimestamp: string
  createdAt: string
}

export interface BreakQueryFilters {
  instrument?: 'DOW' | 'NASDAQ' | 'NIKKEI'
  minConfidence?: number
  maxConfidence?: number
  minLevel?: number
  maxLevel?: number
  startDate?: string
  endDate?: string
  direction?: 'up' | 'down'
  limit?: number
  offset?: number
  sortBy?: 'confidence' | 'timestamp' | 'price'
  sortOrder?: 'asc' | 'desc'
}

export interface BreakListResponse {
  breaks: LevelBreak[]
  total: number
  limit: number
  offset: number
}

export interface BreakStatistics {
  instrument?: 'DOW' | 'NASDAQ' | 'NIKKEI'
  totalBreaks: number
  upBreaks: number
  downBreaks: number
  averageConfidence: number
  maxConfidence: number
  minConfidence: number
  confidenceDistribution: {
    veryHigh: number
    high: number
    medium: number
    low: number
  }
  timeRange: {
    oldest: string | null
    newest: string | null
  }
}
