/**
 * Databento Live Raw API — CRAM challenge-response (not HTTP Basic / not a webhook).
 * Docs: https://databento.com/docs/api-reference-live/basics/authentication
 */

import { createHash } from 'crypto'

/** SHA-256 hex of `cram|key`, then `-${last5}` bucket id. */
export function databentoLiveCramAuth(cram: string, apiKey: string): string {
  const key = apiKey.trim()
  const challenge = cram.trim()
  const digest = createHash('sha256').update(`${challenge}|${key}`, 'utf8').digest('hex')
  const bucketId = key.slice(-5)
  return `${digest}-${bucketId}`
}

/** GLBX.MDP3 → glbx-mdp3.lsg.databento.com */
export function databentoLiveGatewayHost(dataset = 'GLBX.MDP3'): string {
  return `${dataset.replace(/\./g, '-').toLowerCase()}.lsg.databento.com`
}

export const DATABENTO_LIVE_PORT = 13000

/** Auth control line after CRAM (JSON records + pretty prices). */
export function databentoLiveAuthControlLine(
  authToken: string,
  dataset = 'GLBX.MDP3',
  opts?: { heartbeatIntervalS?: number; client?: string }
): string {
  const heartbeat = opts?.heartbeatIntervalS ?? 15
  const client = opts?.client ?? 'tradepulse-desk/1.0'
  return (
    `auth=${authToken}|dataset=${dataset}|encoding=json|compression=none|ts_out=0` +
    `|pretty_px=1|heartbeat_interval_s=${heartbeat}|client=${client}\n`
  )
}
