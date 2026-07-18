/**
 * Fail fast if critical source files are missing from the build context
 * (Railway BuildKit mount / root-directory misconfig).
 */
import fs from 'node:fs'
import path from 'node:path'

const required = [
  'lib/trading/deskLevels.ts',
  'lib/trading/positionSizing.ts',
  'lib/chart/sessionVwap.ts',
  'lib/utils/dateUtils.ts',
  'tsconfig.json',
  'next.config.js',
]

let failed = false
for (const rel of required) {
  const abs = path.resolve(process.cwd(), rel)
  if (!fs.existsSync(abs)) {
    console.error(`[verify-build-context] MISSING ${rel} (cwd=${process.cwd()})`)
    failed = true
  }
}

if (failed) {
  console.error(
    '[verify-build-context] Clear Railway build cache and confirm service Root Directory is the repo root.'
  )
  process.exit(1)
}

console.log('[verify-build-context] ok')
