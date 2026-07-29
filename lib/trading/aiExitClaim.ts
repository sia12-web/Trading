/**
 * Position close claim — interpret PostgREST update+select results so only one
 * concurrent close (AI confirm, SL/TP, manual) records Order History.
 */

export type AiExitClaimResult =
  | { kind: 'won'; positionId: string }
  | { kind: 'already_closed' }
  | { kind: 'error'; message: string }

/** Order History notes line for AI reversal exits. */
export function formatAiExitDecisionNotes(reason: string): string {
  return `AI exit: ${reason}`
}

/**
 * After `.update(...).is('exit_timestamp', null).select('id').maybeSingle()`,
 * only a returned row means this request won the close race.
 */
export function interpretAiExitClaim(args: {
  data: { id: string } | null | undefined
  error: { message?: string } | null | undefined
}): AiExitClaimResult {
  if (args.error) {
    return { kind: 'error', message: args.error.message || 'close failed' }
  }
  if (!args.data?.id) {
    return { kind: 'already_closed' }
  }
  return { kind: 'won', positionId: args.data.id }
}

/** How many of N concurrent claim attempts should write Order History. */
export function countAiExitHistoryWriters(
  claims: Array<{ id: string } | null>
): number {
  return claims.filter((c) => interpretAiExitClaim({ data: c, error: null }).kind === 'won')
    .length
}
