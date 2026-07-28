/**
 * Structured logger for Railway / production diagnosis.
 * Emits one JSON object per line so Railway log search works well.
 *
 * LOG_LEVEL: debug | info | warn | error  (default: info in prod, debug in dev)
 *
 * Every line includes deploy meta (commit / railwayEnv) for correlating incidents.
 * Secret-looking field names are redacted.
 *
 * Call styles supported:
 *   logger.info('msg')
 *   logger.info('msg', { key: value })
 *   logger.error('msg', err)
 *   logger.debug('msg', a, b)  // extras → detail
 *
 * Useful Railway searches:
 *   desk.entry_denied | session-gate.transition | oanda.order_failed | boot.start
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const SENSITIVE_KEY =
  /^(.*_)?(secret|token|password|api[_-]?key|authorization|cookie|private[_-]?key)(_.*)?$/i

function resolveMinLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL || '').toLowerCase()
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug'
}

const MIN_LEVEL = resolveMinLevel()

const DEPLOY_META = {
  commit: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) || null,
  railwayEnv:
    process.env.RAILWAY_ENVIRONMENT_NAME ||
    process.env.RAILWAY_ENVIRONMENT ||
    null,
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[MIN_LEVEL]
}

function safeError(err: unknown): Record<string, unknown> | undefined {
  if (err == null) return undefined
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack?.split('\n').slice(0, 12).join('\n'),
    }
  }
  if (typeof err === 'object') return redactFields(err as Record<string, unknown>)
  return { message: String(err) }
}

function isPlainFields(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !(value instanceof Error) &&
    !Array.isArray(value)
  )
}

function redactFields(
  input: Record<string, unknown>,
  depth = 0
): Record<string, unknown> {
  if (depth > 4) return { truncated: true }
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_KEY.test(key)) {
      out[key] = '[redacted]'
      continue
    }
    if (isPlainFields(value)) {
      out[key] = redactFields(value, depth + 1)
    } else if (Array.isArray(value)) {
      out[key] = value.map((item) =>
        isPlainFields(item) ? redactFields(item, depth + 1) : serializeDetail(item)
      )
    } else {
      out[key] = serializeDetail(value)
    }
  }
  return out
}

function serializeDetail(value: unknown): unknown {
  if (value instanceof Error) return safeError(value)
  if (typeof value === 'bigint') return value.toString()
  return value
}

function emit(level: LogLevel, message: string, extras: unknown[]) {
  if (!shouldLog(level)) return

  let fields: Record<string, unknown> = {}

  if (extras.length === 1 && isPlainFields(extras[0])) {
    fields = redactFields(extras[0])
  } else if (extras.length === 1 && extras[0] instanceof Error) {
    fields = { err: extras[0] }
  } else if (extras.length > 0) {
    fields = { detail: extras.map(serializeDetail) }
  }

  const { err, error, ...rest } = fields
  const payload: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    service: 'trading-desk',
    ...DEPLOY_META,
    ...rest,
  }

  const errObj = safeError(err ?? error)
  if (errObj) payload.err = errObj

  const line = JSON.stringify(payload)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

type LogFn = (message: string, ...extras: unknown[]) => void

export const logger: {
  debug: LogFn
  info: LogFn
  log: LogFn
  warn: LogFn
  error: LogFn
} = {
  debug: (message, ...extras) => emit('debug', message, extras),
  info: (message, ...extras) => emit('info', message, extras),
  log: (message, ...extras) => emit('info', message, extras),
  warn: (message, ...extras) => emit('warn', message, extras),
  error: (message, ...extras) => emit('error', message, extras),
}
