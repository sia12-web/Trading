'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  SavedWyckoffEdge,
  loadWyckoffEdges,
  saveWyckoffEdge,
  deleteWyckoffEdge,
  toggleWyckoffEdgeMemory,
  updateWyckoffEdgeNotes,
  subscribeToWyckoffEdges,
} from '@/lib/trading/wyckoffEdgesStore';

const MARKETS = ['ALL', 'GOLD', 'NASDAQ', 'DOW', 'CRUDE', 'SILVER', 'NIKKEI'] as const;
type MarketFilter = (typeof MARKETS)[number];

const DEFAULT_MARKET_RANGES: Record<string, { lowPrice: number; highPrice: number; label: string }> = {
  GOLD: { lowPrice: 2880, highPrice: 2960, label: 'GOLD 4H Macro Range Backtest' },
  NASDAQ: { lowPrice: 21200, highPrice: 21950, label: 'NASDAQ 4H Macro Range Backtest' },
  DOW: { lowPrice: 43200, highPrice: 44600, label: 'DOW 4H Macro Range Backtest' },
  CRUDE: { lowPrice: 66.5, highPrice: 72.5, label: 'CRUDE 4H Macro Range Backtest' },
  SILVER: { lowPrice: 31.2, highPrice: 33.8, label: 'SILVER 4H Macro Range Backtest' },
  NIKKEI: { lowPrice: 38100, highPrice: 39600, label: 'NIKKEI 4H Macro Range Backtest' },
};

export default function EdgesPage() {
  const [edges, setEdges] = useState<SavedWyckoffEdge[]>([]);
  const [selectedMarket, setSelectedMarket] = useState<MarketFilter>('ALL');
  const [expandedEdgeId, setExpandedEdgeId] = useState<string | null>(null);
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<string>('');
  const [isRunningBacktest, setIsRunningBacktest] = useState<boolean>(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Quick 4H Range Backtest Runner state
  const [runnerMarket, setRunnerMarket] = useState<string>('GOLD');
  const [runnerLow, setRunnerLow] = useState<string>('2880');
  const [runnerHigh, setRunnerHigh] = useState<string>('2960');
  const [runnerLabel, setRunnerLabel] = useState<string>('GOLD 4H Macro Range Backtest');

  useEffect(() => {
    const initial = loadWyckoffEdges();
    setEdges(initial);
    if (initial.length > 0 && initial[0]) {
      setExpandedEdgeId(initial[0].id);
    }

    const unsubscribe = subscribeToWyckoffEdges(() => {
      setEdges(loadWyckoffEdges());
    });
    return unsubscribe;
  }, []);

  // Auto-seed initial 4H Backtest Edges on first visit if empty so trader & Leo immediately have reference 4H Edges
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const existing = loadWyckoffEdges();
    const seededFlag = window.localStorage.getItem('wyckoff_4h_edges_seeded_v1');
    if (existing.length === 0 && !seededFlag) {
      window.localStorage.setItem('wyckoff_4h_edges_seeded_v1', '1');
      void (async () => {
        try {
          setIsRunningBacktest(true);
          const nowSec = Math.floor(Date.now() / 1000);
          const startSec = nowSec - 45 * 86400;
          for (const mkt of ['GOLD', 'NASDAQ'] as const) {
            const cfg = DEFAULT_MARKET_RANGES[mkt];
            if (!cfg) continue;
            const res = await fetch('/api/trading/edges/backtest-box', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: `seed-4h-${mkt.toLowerCase()}`,
                market: mkt,
                timeframe: '4H',
                startTime: startSec,
                endTime: nowSec,
                lowPrice: cfg.lowPrice,
                highPrice: cfg.highPrice,
                label: cfg.label,
              }),
            });
            if (res.ok) {
              const data = await res.json();
              if (data?.savedEdge) {
                saveWyckoffEdge(data.savedEdge);
              }
            }
          }
          const updated = loadWyckoffEdges();
          setEdges(updated);
          if (updated.length > 0 && updated[0]) {
            setExpandedEdgeId(updated[0].id);
          }
        } catch {
          // non-fatal
        } finally {
          setIsRunningBacktest(false);
        }
      })();
    }
  }, []);

  const filteredEdges = useMemo(() => {
    if (selectedMarket === 'ALL') return edges;
    return edges.filter((e) => e.market.toUpperCase() === selectedMarket);
  }, [edges, selectedMarket]);

  const activeMemoryCount = useMemo(
    () => edges.filter((e) => e.isActiveInLeoMemory).length,
    [edges]
  );

  const handleMarketPresetChange = (mkt: string) => {
    setRunnerMarket(mkt);
    const preset = DEFAULT_MARKET_RANGES[mkt];
    if (preset) {
      setRunnerLow(String(preset.lowPrice));
      setRunnerHigh(String(preset.highPrice));
      setRunnerLabel(preset.label);
    }
  };

  const handleRun4HBacktest = async (e: React.FormEvent) => {
    e.preventDefault();
    const lowNum = parseFloat(runnerLow);
    const highNum = parseFloat(runnerHigh);
    if (!Number.isFinite(lowNum) || !Number.isFinite(highNum) || lowNum <= 0 || highNum <= 0) {
      setStatusBanner('Please enter valid positive Low and High prices for the 4H range.');
      return;
    }

    setIsRunningBacktest(true);
    setStatusBanner(null);
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      const startSec = nowSec - 45 * 86400; // 45-day 4H macro range window
      const res = await fetch('/api/trading/edges/backtest-box', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: `box-4h-${runnerMarket.toLowerCase()}-${nowSec}`,
          market: runnerMarket,
          timeframe: '4H',
          startTime: startSec,
          endTime: nowSec,
          lowPrice: Math.min(lowNum, highNum),
          highPrice: Math.max(lowNum, highNum),
          label: runnerLabel.trim() || `${runnerMarket} 4H Range Backtest`,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.savedEdge) {
        setStatusBanner(data?.error || 'Failed to backtest 4H range.');
        return;
      }
      const saved = saveWyckoffEdge(data.savedEdge);
      const refreshed = loadWyckoffEdges();
      setEdges(refreshed);
      setExpandedEdgeId(saved.id);
      setStatusBanner(
        `Saved ${saved.market} 4H Range Backtest Edge (${saved.lowPrice.toFixed(2)} – ${saved.highPrice.toFixed(2)}) on ${saved.createdDateFormatted}. Active in Leo Memory for 5m Phase D & E!`
      );
    } catch (err: any) {
      setStatusBanner(err?.message || 'Error running 4H range backtest.');
    } finally {
      setIsRunningBacktest(false);
    }
  };

  const handleToggleMemory = (edge: SavedWyckoffEdge) => {
    toggleWyckoffEdgeMemory(edge.id, !edge.isActiveInLeoMemory);
    setEdges(loadWyckoffEdges());
  };

  const handleDeleteEdge = (id: string) => {
    deleteWyckoffEdge(id);
    const updated = loadWyckoffEdges();
    setEdges(updated);
    if (expandedEdgeId === id) {
      setExpandedEdgeId(updated[0]?.id ?? null);
    }
  };

  const handleStartEditNotes = (edge: SavedWyckoffEdge) => {
    setEditingNotesId(edge.id);
    setNotesDraft(edge.traderNotes || '');
  };

  const handleSaveNotes = (id: string) => {
    updateWyckoffEdgeNotes(id, notesDraft);
    setEdges(loadWyckoffEdges());
    setEditingNotesId(null);
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#080c14',
        color: '#e2e8f0',
        padding: '24px 28px 64px',
        fontFamily: 'var(--font-sans, Inter, system-ui, sans-serif)',
      }}
    >
      {/* Top Header */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16,
          marginBottom: 24,
          paddingBottom: 18,
          borderBottom: '1px solid rgba(148,163,184,0.14)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span
              style={{
                padding: '3px 9px',
                borderRadius: 6,
                background: 'rgba(16,185,129,0.14)',
                border: '1px solid rgba(16,185,129,0.38)',
                color: '#34d399',
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: '0.07em',
              }}
            >
              4H WYCKOFF EDGES & LEO MEMORY
            </span>
            <span
              style={{
                padding: '3px 9px',
                borderRadius: 6,
                background: 'rgba(56,189,248,0.12)',
                border: '1px solid rgba(56,189,248,0.32)',
                color: '#38bdf8',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              🧠 {activeMemoryCount} Active in Leo 5m Memory
            </span>
          </div>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 800,
              color: '#f8fafc',
              margin: 0,
              letterSpacing: '-0.02em',
            }}
          >
            4H Range Backtest Edges — Accumulation & Distribution Behaviors
          </h1>
          <p
            style={{
              fontSize: 13,
              color: '#94a3b8',
              marginTop: 6,
              maxWidth: 880,
              lineHeight: 1.55,
            }}
          >
            Every time Leo backtests a <strong>4-Hour (4H) Range</strong>, the exact characteristics of{' '}
            <strong style={{ color: '#34d399' }}>Accumulation</strong> (Springs, Higher-Low Bases, CVD Absorption, Mark-Up MFE) and{' '}
            <strong style={{ color: '#f87171' }}>Distribution</strong> (UTADs, Lower-High LPSYs, Supply Exhaustion, Mark-Down MFE) are dated, written, and saved here. Leo retains these Edges in memory so when you switch to the{' '}
            <strong style={{ color: '#38bdf8' }}>5-Minute (5m) Timeframe</strong>, he uses them alongside the{' '}
            <strong>Last 5 Days POC</strong>, <strong>Overnight Inventory (Asia/London Cause)</strong>, and{' '}
            <strong>Yesterday NYC</strong> to pinpoint <strong>Phase D</strong> and <strong>Phase E (LPS / LPSY)</strong>.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link
            href="/dashboard/chart"
            style={{
              padding: '9px 15px',
              borderRadius: 8,
              background: 'linear-gradient(135deg, rgba(16,185,129,0.22), rgba(56,189,248,0.18))',
              border: '1px solid rgba(16,185,129,0.45)',
              color: '#ecfdf5',
              fontSize: 12.5,
              fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            📈 Open 4H / 5m Trading Chart →
          </Link>
        </div>
      </div>

      {/* Status Banner */}
      {statusBanner && (
        <div
          style={{
            marginBottom: 18,
            padding: '11px 15px',
            borderRadius: 10,
            background: 'rgba(16,185,129,0.12)',
            border: '1px solid rgba(16,185,129,0.35)',
            color: '#6ee7b7',
            fontSize: 12.5,
            fontWeight: 600,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>✅ {statusBanner}</span>
          <button
            onClick={() => setStatusBanner(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* On-Demand 4H Range Backtest & Edge Generator */}
      <form
        onSubmit={handleRun4HBacktest}
        style={{
          marginBottom: 24,
          padding: '16px 18px',
          borderRadius: 12,
          background: 'rgba(15,23,42,0.82)',
          border: '1px solid rgba(56,189,248,0.24)',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          gap: 14,
        }}
      >
        <div style={{ flex: '0 0 auto' }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: '#38bdf8', marginBottom: 4, letterSpacing: '0.05em' }}>
            🔬 BACKTEST NEW 4H RANGE & SAVE TO LEO MEMORY
          </div>
          <div style={{ fontSize: 11.5, color: '#94a3b8' }}>
            Backtests 4H bars in the range, writes Accumulation & Distribution behaviors, dates & saves to Leo Memory.
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginLeft: 'auto' }}>
          <div>
            <label style={{ display: 'block', fontSize: 10.5, color: '#94a3b8', marginBottom: 4 }}>Market</label>
            <select
              value={runnerMarket}
              onChange={(e) => handleMarketPresetChange(e.target.value)}
              style={{
                padding: '7px 10px',
                borderRadius: 7,
                background: '#090d16',
                border: '1px solid rgba(148,163,184,0.28)',
                color: '#f8fafc',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {(['GOLD', 'NASDAQ', 'DOW', 'CRUDE', 'SILVER', 'NIKKEI'] as const).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 10.5, color: '#94a3b8', marginBottom: 4 }}>4H Range Low</label>
            <input
              type="number"
              step="any"
              value={runnerLow}
              onChange={(e) => setRunnerLow(e.target.value)}
              style={{
                width: 105,
                padding: '7px 10px',
                borderRadius: 7,
                background: '#090d16',
                border: '1px solid rgba(148,163,184,0.28)',
                color: '#34d399',
                fontSize: 12,
                fontWeight: 700,
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 10.5, color: '#94a3b8', marginBottom: 4 }}>4H Range High</label>
            <input
              type="number"
              step="any"
              value={runnerHigh}
              onChange={(e) => setRunnerHigh(e.target.value)}
              style={{
                width: 105,
                padding: '7px 10px',
                borderRadius: 7,
                background: '#090d16',
                border: '1px solid rgba(148,163,184,0.28)',
                color: '#f87171',
                fontSize: 12,
                fontWeight: 700,
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 10.5, color: '#94a3b8', marginBottom: 4 }}>Edge Label</label>
            <input
              type="text"
              value={runnerLabel}
              onChange={(e) => setRunnerLabel(e.target.value)}
              placeholder="e.g. GOLD 4H Macro Range"
              style={{
                width: 210,
                padding: '7px 10px',
                borderRadius: 7,
                background: '#090d16',
                border: '1px solid rgba(148,163,184,0.28)',
                color: '#e2e8f0',
                fontSize: 12,
              }}
            />
          </div>

          <button
            type="submit"
            disabled={isRunningBacktest}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              background: isRunningBacktest
                ? 'rgba(56,189,248,0.12)'
                : 'linear-gradient(135deg, #0284c7, #059669)',
              border: '1px solid rgba(56,189,248,0.45)',
              color: '#ffffff',
              fontSize: 12,
              fontWeight: 800,
              cursor: isRunningBacktest ? 'wait' : 'pointer',
            }}
          >
            {isRunningBacktest ? 'Backtesting 4H Range...' : '🔬 Backtest 4H & Save Edge'}
          </button>
        </div>
      </form>

      {/* Market Filter Tabs */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
           justifyContent: 'space-between',
          gap: 12,
          marginBottom: 18,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {MARKETS.map((mkt) => {
            const active = selectedMarket === mkt;
            const count =
              mkt === 'ALL'
                ? edges.length
                : edges.filter((e) => e.market.toUpperCase() === mkt).length;
            return (
              <button
                key={mkt}
                onClick={() => setSelectedMarket(mkt)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  background: active ? 'rgba(56,189,248,0.18)' : 'rgba(15,23,42,0.7)',
                  border: active
                    ? '1px solid rgba(56,189,248,0.55)'
                    : '1px solid rgba(148,163,184,0.16)',
                  color: active ? '#38bdf8' : '#94a3b8',
                  fontSize: 12,
                  fontWeight: active ? 800 : 600,
                  cursor: 'pointer',
                }}
              >
                {mkt} ({count})
              </button>
            );
          })}
        </div>

        <div style={{ fontSize: 12, color: '#64748b' }}>
          Showing <strong>{filteredEdges.length}</strong> saved 4H Range Backtest Edge{filteredEdges.length === 1 ? '' : 's'}
        </div>
      </div>

      {/* Saved 4H Edges List */}
      {filteredEdges.length === 0 ? (
        <div
          style={{
            padding: '48px 24px',
            borderRadius: 14,
            background: 'rgba(15,23,42,0.65)',
            border: '1px dashed rgba(148,163,184,0.24)',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 8 }}>
            No 4H Wyckoff Edges saved for {selectedMarket === 'ALL' ? 'any market' : selectedMarket} yet
          </div>
          <p style={{ fontSize: 13, color: '#94a3b8', maxWidth: 560, margin: '0 auto 16px' }}>
            Draw a box range on the <strong>4H chart</strong> and click <strong>🔬 Backtest 4H Range</strong>, or use the{' '}
            <strong>Backtest New 4H Range</strong> bar above to record Accumulation and Distribution behaviors into Leo&apos;s memory.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {filteredEdges.map((edge) => {
            const isExpanded = expandedEdgeId === edge.id;
            const regimeColor =
              edge.dominantRegime === 'ACCUMULATION'
                ? '#34d399'
                : edge.dominantRegime === 'DISTRIBUTION'
                ? '#f87171'
                : '#fbbf24';
            const regimeBg =
              edge.dominantRegime === 'ACCUMULATION'
                ? 'rgba(16,185,129,0.14)'
                : edge.dominantRegime === 'DISTRIBUTION'
                ? 'rgba(239,68,68,0.14)'
                : 'rgba(245,158,11,0.14)';

            return (
              <div
                key={edge.id}
                style={{
                  borderRadius: 14,
                  background: 'rgba(15,23,42,0.88)',
                  border: edge.isActiveInLeoMemory
                    ? '1px solid rgba(56,189,248,0.38)'
                    : '1px solid rgba(148,163,184,0.16)',
                  overflow: 'hidden',
                  boxShadow: '0 10px 28px rgba(0,0,0,0.32)',
                }}
              >
                {/* Card Header */}
                <div
                  style={{
                    padding: '16px 20px',
                    background: 'rgba(9,13,22,0.75)',
                    borderBottom: '1px solid rgba(148,163,184,0.12)',
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                    <span
                      style={{
                        padding: '4px 10px',
                        borderRadius: 6,
                        background: 'rgba(56,189,248,0.15)',
                        border: '1px solid rgba(56,189,248,0.4)',
                        color: '#38bdf8',
                        fontSize: 12,
                        fontWeight: 800,
                      }}
                    >
                      {edge.market} · 4H RANGE
                    </span>

                    <span
                      style={{
                        padding: '4px 10px',
                        borderRadius: 6,
                        background: regimeBg,
                        border: `1px solid ${regimeColor}55`,
                        color: regimeColor,
                        fontSize: 11.5,
                        fontWeight: 800,
                      }}
                    >
                      {edge.dominantRegime} ({edge.confidencePct}% Conf)
                    </span>

                    <span style={{ fontSize: 14.5, fontWeight: 800, color: '#f8fafc' }}>
                      {edge.label}
                    </span>

                    <span
                      style={{
                        fontSize: 12,
                        color: '#94a3b8',
                        background: 'rgba(30,41,59,0.7)',
                        padding: '3px 9px',
                        borderRadius: 6,
                      }}
                    >
                      📅 Backtested & Saved: <strong style={{ color: '#e2e8f0' }}>{edge.createdDateFormatted}</strong>
                    </span>
                  </div>

                  {/* Header Actions */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                    <button
                      onClick={() => handleToggleMemory(edge)}
                      title="When active, Leo automatically recalls this 4H Edge when analyzing the 5-minute chart for Phase D & Phase E"
                      style={{
                        padding: '5px 11px',
                        borderRadius: 7,
                        background: edge.isActiveInLeoMemory
                          ? 'rgba(16,185,129,0.18)'
                          : 'rgba(30,41,59,0.7)',
                        border: edge.isActiveInLeoMemory
                          ? '1px solid rgba(16,185,129,0.5)'
                          : '1px solid rgba(148,163,184,0.25)',
                        color: edge.isActiveInLeoMemory ? '#34d399' : '#94a3b8',
                        fontSize: 11.5,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {edge.isActiveInLeoMemory ? '🧠 Active in Leo 5m Memory' : '⚪ Inactive in Leo Memory'}
                    </button>

                    <button
                      onClick={() => setExpandedEdgeId(isExpanded ? null : edge.id)}
                      style={{
                        padding: '5px 11px',
                        borderRadius: 7,
                        background: 'rgba(30,41,59,0.8)',
                        border: '1px solid rgba(148,163,184,0.25)',
                        color: '#e2e8f0',
                        fontSize: 11.5,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {isExpanded ? 'Hide Details ▲' : 'View Full Behavior ▼'}
                    </button>

                    <button
                      onClick={() => handleDeleteEdge(edge.id)}
                      style={{
                        padding: '5px 9px',
                        borderRadius: 7,
                        background: 'rgba(239,68,68,0.12)',
                        border: '1px solid rgba(239,68,68,0.3)',
                        color: '#f87171',
                        fontSize: 11.5,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {/* Key Metrics Bar */}
                <div
                  style={{
                    padding: '12px 20px',
                    background: 'rgba(15,23,42,0.55)',
                    borderBottom: '1px solid rgba(148,163,184,0.1)',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))',
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 10.5, color: '#64748b', fontWeight: 700 }}>4H RANGE BOUNDARIES</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#f8fafc', marginTop: 2 }}>
                      {edge.lowPrice.toFixed(2)} – {edge.highPrice.toFixed(2)}{' '}
                      <span style={{ color: '#38bdf8', fontSize: 11.5 }}>({edge.priceSpanPts.toFixed(2)} pts)</span>
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: 10.5, color: '#64748b', fontWeight: 700 }}>HISTORICAL WINDOW</div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: '#e2e8f0', marginTop: 2 }}>
                      {edge.rangeStartDate} → {edge.rangeEndDate} ({edge.durationDays.toFixed(1)}d)
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: 10.5, color: '#64748b', fontWeight: 700 }}>4H POC / VAH / VAL</div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: '#fbbf24', marginTop: 2 }}>
                      POC {edge.poc.toFixed(2)}{' '}
                      <span style={{ color: '#94a3b8', fontSize: 11 }}>
                        ({edge.val.toFixed(2)} – {edge.vah.toFixed(2)})
                      </span>
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: 10.5, color: '#64748b', fontWeight: 700 }}>4H CYCLES DETECTED</div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 2 }}>
                      <span style={{ color: '#34d399' }}>{edge.accumulationCount} Acc</span>
                      {' · '}
                      <span style={{ color: '#f87171' }}>{edge.distributionCount} Dist</span>
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: 10.5, color: '#64748b', fontWeight: 700 }}>4H NET CVD & ATR</div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: '#e2e8f0', marginTop: 2 }}>
                      {edge.h4CvdBias} · ATR {edge.h4Atr.toFixed(2)}
                    </div>
                  </div>
                </div>

                {/* Written Accumulation & Distribution Behaviors (Always visible summary + expandable deep dive) */}
                <div
                  style={{
                    padding: '18px 20px',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
                    gap: 16,
                  }}
                >
                  {/* Written Accumulation Behavior */}
                  <div
                    style={{
                      padding: '15px 16px',
                      borderRadius: 11,
                      background: 'rgba(6,78,59,0.16)',
                      border: '1px solid rgba(16,185,129,0.32)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 10,
                      }}
                    >
                      <span style={{ fontSize: 12, fontWeight: 800, color: '#34d399', letterSpacing: '0.04em' }}>
                        🟢 WRITTEN 4H ACCUMULATION BEHAVIOR ({edge.accumulationCount} Cycles)
                      </span>
                      <span style={{ fontSize: 11, color: '#6ee7b7', fontWeight: 700 }}>
                        1R Win: {edge.accumulationBehavior.winRate1RPct.toFixed(0)}% · 2R Win:{' '}
                        {edge.accumulationBehavior.winRate2RPct.toFixed(0)}%
                      </span>
                    </div>

                    <p
                      style={{
                        fontSize: 12.5,
                        color: '#ecfdf5',
                        lineHeight: 1.55,
                        margin: '0 0 12px',
                      }}
                    >
                      {edge.accumulationBehavior.summaryText}
                    </p>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, 1fr)',
                        gap: 8,
                        paddingTop: 10,
                        borderTop: '1px solid rgba(16,185,129,0.2)',
                        fontSize: 11.5,
                      }}
                    >
                      <div>
                        <span style={{ color: '#94a3b8', display: 'block', fontSize: 10 }}>Higher-Low Base</span>
                        <strong style={{ color: '#34d399' }}>
                          {edge.accumulationBehavior.higherLowBaseRatePct.toFixed(0)}% ({edge.accumulationBehavior.higherLowBaseCount})
                        </strong>
                      </div>
                      <div>
                        <span style={{ color: '#94a3b8', display: 'block', fontSize: 10 }}>Spring / Shakeout</span>
                        <strong style={{ color: '#34d399' }}>
                          {edge.accumulationBehavior.springRatePct.toFixed(0)}% (avg {edge.accumulationBehavior.avgSpringDepthPts.toFixed(2)} pts)
                        </strong>
                      </div>
                      <div>
                        <span style={{ color: '#94a3b8', display: 'block', fontSize: 10 }}>Avg Mark-Up MFE</span>
                        <strong style={{ color: '#34d399' }}>
                          +{edge.accumulationBehavior.avgMarkupMfePts.toFixed(2)} pts
                        </strong>
                      </div>
                    </div>
                  </div>

                  {/* Written Distribution Behavior */}
                  <div
                    style={{
                      padding: '15px 16px',
                      borderRadius: 11,
                      background: 'rgba(127,29,29,0.16)',
                      border: '1px solid rgba(239,68,68,0.32)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 10,
                      }}
                    >
                      <span style={{ fontSize: 12, fontWeight: 800, color: '#f87171', letterSpacing: '0.04em' }}>
                        🔴 WRITTEN 4H DISTRIBUTION BEHAVIOR ({edge.distributionCount} Cycles)
                      </span>
                      <span style={{ fontSize: 11, color: '#fca5a5', fontWeight: 700 }}>
                        UTAD CVD Abs: {edge.distributionBehavior.utadCvdAbsorptionPct.toFixed(0)}%
                      </span>
                    </div>

                    <p
                      style={{
                        fontSize: 12.5,
                        color: '#fef2f2',
                        lineHeight: 1.55,
                        margin: '0 0 12px',
                      }}
                    >
                      {edge.distributionBehavior.summaryText}
                    </p>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, 1fr)',
                        gap: 8,
                        paddingTop: 10,
                        borderTop: '1px solid rgba(239,68,68,0.2)',
                        fontSize: 11.5,
                      }}
                    >
                      <div>
                        <span style={{ color: '#94a3b8', display: 'block', fontSize: 10 }}>Lower-High LPSY</span>
                        <strong style={{ color: '#f87171' }}>
                          {edge.distributionBehavior.lowerHighLpsyRatePct.toFixed(0)}%
                        </strong>
                      </div>
                      <div>
                        <span style={{ color: '#94a3b8', display: 'block', fontSize: 10 }}>UTAD / Upthrust</span>
                        <strong style={{ color: '#f87171' }}>
                          {edge.distributionBehavior.utadRatePct.toFixed(0)}% (avg {edge.distributionBehavior.avgUtadDepthPts.toFixed(2)} pts)
                        </strong>
                      </div>
                      <div>
                        <span style={{ color: '#94a3b8', display: 'block', fontSize: 10 }}>Avg Mark-Down MFE</span>
                        <strong style={{ color: '#f87171' }}>
                          -{edge.distributionBehavior.avgMarkdownMfePts.toFixed(2)} pts
                        </strong>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Expanded Section: 5m Phase D & Phase E Execution Blueprint + Sub-Legs + Trader Notes */}
                {isExpanded && (
                  <div
                    style={{
                      padding: '0 20px 20px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 14,
                    }}
                  >
                    {/* 5m Phase D & Phase E Blueprint (Used by Leo Memory) */}
                    <div
                      style={{
                        padding: '14px 16px',
                        borderRadius: 10,
                        background: 'rgba(14,116,144,0.14)',
                        border: '1px solid rgba(56,189,248,0.32)',
                      }}
                    >
                      <div
                        style={{
                          fontSize: 11.5,
                          fontWeight: 800,
                          color: '#38bdf8',
                          marginBottom: 8,
                          letterSpacing: '0.04em',
                        }}
                      >
                        ⚡ LEO MEMORY — 5-MINUTE (5m) PHASE D & PHASE E EXECUTION BLUEPRINT
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, color: '#e0f2fe', lineHeight: 1.55 }}>
                        <div>
                          <strong style={{ color: '#7dd3fc' }}>• Time as a Regulator (Asia/London Cause → NYC Effect): </strong>
                          {edge.phaseDEExecutionPlan.timeAsRegulatorNote}
                        </div>
                        <div>
                          <strong style={{ color: '#34d399' }}>• 5m Phase D Opportunity (Stepping-Stone Re-Acc / Re-Dist → Big Volume Breakout): </strong>
                          {edge.phaseDEExecutionPlan.phaseDOpportunityNote}
                        </div>
                        <div>
                          <strong style={{ color: '#fbbf24' }}>• 5m Phase E Opportunity (LPS / LPSY Boundary Revisit): </strong>
                          {edge.phaseDEExecutionPlan.phaseEOpportunityNote}
                        </div>
                      </div>
                    </div>

                    {/* Sub-Legs inside the 4H Range */}
                    {edge.subLegs && edge.subLegs.length > 0 && (
                      <div
                        style={{
                          padding: '12px 16px',
                          borderRadius: 10,
                          background: 'rgba(9,13,22,0.65)',
                          border: '1px solid rgba(148,163,184,0.14)',
                        }}
                      >
                        <div style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', marginBottom: 8 }}>
                          DETECTED 4H ACCUMULATION & DISTRIBUTION SUB-LEGS ({edge.subLegs.length})
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {edge.subLegs.map((leg, idx) => (
                            <div
                              key={leg.id || idx}
                              style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: 8,
                                padding: '6px 10px',
                                borderRadius: 7,
                                background: 'rgba(15,23,42,0.8)',
                                fontSize: 11.5,
                              }}
                            >
                              <span
                                style={{
                                  fontWeight: 800,
                                  color:
                                    leg.type === 'ACCUMULATION' || leg.type === 'MARKUP'
                                      ? '#34d399'
                                      : '#f87171',
                                }}
                              >
                                #{idx + 1} {leg.type} — {leg.label}
                              </span>
                              <span style={{ color: '#cbd5e1' }}>
                                {leg.lowPrice.toFixed(2)} – {leg.highPrice.toFixed(2)} (POC {leg.poc.toFixed(2)})
                              </span>
                              <span style={{ color: '#94a3b8' }}>{leg.behaviorNote}</span>
                              <span style={{ color: '#38bdf8', fontWeight: 700 }}>
                                {leg.spanPts.toFixed(2)} pts
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Editable Trader Notes on this 4H Edge */}
                    <div
                      style={{
                        padding: '12px 16px',
                        borderRadius: 10,
                        background: 'rgba(9,13,22,0.65)',
                        border: '1px solid rgba(148,163,184,0.14)',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: 6,
                        }}
                      >
                        <span style={{ fontSize: 11, fontWeight: 800, color: '#cbd5e1' }}>
                          ✍️ WRITTEN BEHAVIOR & TRADER NOTES (SYNCED WITH LEO MEMORY)
                        </span>
                        {editingNotesId !== edge.id && (
                          <button
                            onClick={() => handleStartEditNotes(edge)}
                            style={{
                              padding: '3px 9px',
                              borderRadius: 6,
                              background: 'rgba(56,189,248,0.14)',
                              border: '1px solid rgba(56,189,248,0.35)',
                              color: '#38bdf8',
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            Edit Notes
                          </button>
                        )}
                      </div>

                      {editingNotesId === edge.id ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <textarea
                            rows={3}
                            value={notesDraft}
                            onChange={(e) => setNotesDraft(e.target.value)}
                            placeholder="Write additional 4H Accumulation / Distribution observations or 5m Phase D/E session notes for Leo..."
                            style={{
                              width: '100%',
                              padding: '8px 10px',
                              borderRadius: 8,
                              background: '#080c14',
                              border: '1px solid rgba(56,189,248,0.4)',
                              color: '#f8fafc',
                              fontSize: 12,
                              lineHeight: 1.5,
                            }}
                          />
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              onClick={() => handleSaveNotes(edge.id)}
                              style={{
                                padding: '5px 12px',
                                borderRadius: 6,
                                background: '#059669',
                                border: 'none',
                                color: '#fff',
                                fontSize: 11.5,
                                fontWeight: 700,
                                cursor: 'pointer',
                              }}
                            >
                              Save to Edge & Leo Memory
                            </button>
                            <button
                              onClick={() => setEditingNotesId(null)}
                              style={{
                                padding: '5px 12px',
                                borderRadius: 6,
                                background: 'transparent',
                                border: '1px solid rgba(148,163,184,0.3)',
                                color: '#94a3b8',
                                fontSize: 11.5,
                                cursor: 'pointer',
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, color: edge.traderNotes ? '#e2e8f0' : '#64748b', lineHeight: 1.5 }}>
                          {edge.traderNotes ||
                            'No custom annotations added yet. Click "Edit Notes" to add extra 4H Accumulation/Distribution notes for Leo.'}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
