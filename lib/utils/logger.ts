/**
 * Logger Utility
 * Wraps console methods with debug flag to suppress logs in production
 */

const DEBUG = process.env.NODE_ENV === 'development'

export const logger = {
  debug: (...args: unknown[]) => {
    if (DEBUG) console.debug(...args)
  },
  log: (...args: unknown[]) => {
    if (DEBUG) console.log(...args)
  },
  warn: (...args: unknown[]) => {
    console.warn(...args)
  },
  error: (...args: unknown[]) => {
    console.error(...args)
  },
}
