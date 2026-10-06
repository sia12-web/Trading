import assert from 'node:assert/strict'
import { nextWtiContractSymbol } from '@/lib/fundamentals/oilStateStore'
import { DEFAULT_PILLARS_STATE } from '@/lib/fundamentals/oilAnalystConfig'
import { oasToBps } from '@/lib/fundamentals/liveQuotes'
import { computeNikkeiContributions } from '@/lib/fundamentals/nikkeiAnalystEngine'
import { evaluateSectorRotation } from '@/lib/fundamentals/dowAnalystEngine'

const nov = nextWtiContractSymbol('Crude Oil Nov 26')
assert.equal(nov, 'CLZ26.NYM')

const dec = nextWtiContractSymbol('Crude Oil Dec 26')
assert.equal(dec, 'CLF27.NYM')

assert.equal(nextWtiContractSymbol('no month here'), null)

const pillarText = JSON.stringify(DEFAULT_PILLARS_STATE)
assert.equal(pillarText.includes('13.40'), false)
assert.equal(pillarText.includes('148,200'), false)
assert.equal(pillarText.includes('0.38'), false)
for (const pillar of Object.values(DEFAULT_PILLARS_STATE)) {
  assert.equal(pillar.confidence, 0)
  assert.equal(pillar.bias, 'NEUTRAL')
}

assert.equal(oasToBps(3.15), 315)
assert.equal(oasToBps(315), 315)

const emptyWeights = computeNikkeiContributions([
  { symbol: '9983.T', name: 'Fast Retailing', priceJpy: 0, weightPct: 10, sector: 'Retail', betaToUsdJpy: 0 },
])
assert.equal(emptyWeights.fastRetailingWeightPct, 0)
assert.equal(emptyWeights.sumSharePricesJpy, 0)

const quiet = evaluateSectorRotation({ ymChangePct: 0, esChangePct: 0, nqChangePct: 0, rtyChangePct: 0 })
assert.equal(quiet.rotationRegime, 'BALANCED')

console.log('fundamentals live curve checks passed')
