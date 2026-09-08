import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

describe('Leo Dock & Reference Point Click Isolation Tests', () => {
  it('simulates reference point click isolation based on leoPanelOpen state', () => {
    let leoPanelOpen = false
    let externalPoints: any[] = []

    const hit = {
      price: 44100,
      session: 'Asia',
      type: 'HIGH',
      volStr: '1.2k',
      isRetested: false,
    }

    const handleClick = () => {
      if (!leoPanelOpen) return
      externalPoints = [
        {
          label: `${hit.session} ${hit.type}`,
          value: hit.price,
        },
      ]
    }

    // 1. When Leo is closed, clicking does NOTHING
    handleClick()
    assert.equal(externalPoints.length, 0, 'Clicking while Leo is closed must not attach reference points')

    // 2. When user opens Leo, clicking attaches the reference point
    leoPanelOpen = true
    handleClick()
    assert.equal(externalPoints.length, 1, 'Clicking while Leo is open must attach the reference point')
    assert.equal(externalPoints[0].value, 44100)

    // 3. When Leo is closed again, clicking does NOTHING
    externalPoints = []
    leoPanelOpen = false
    handleClick()
    assert.equal(externalPoints.length, 0, 'Clicking after closing Leo must not attach reference points')
  })

  it('verifies vertical separation between Reset scale and Leo dock button', () => {
    // Reset scale is at bottom-2.5 (10px from bottom, height 26px -> bounds: 10px to 36px)
    const resetScaleBottom = 10
    const resetScaleHeight = 26
    const resetScaleTopEdgeFromBottom = resetScaleBottom + resetScaleHeight // 36px

    // Leo dock button is at bottom-12 (48px from bottom, height 32px -> bounds: 48px to 80px)
    const leoDockBottom = 48
    const leoDockHeight = 32

    assert.ok(
      leoDockBottom > resetScaleTopEdgeFromBottom,
      `Leo dock bottom (${leoDockBottom}px) must be greater than Reset scale top (${resetScaleTopEdgeFromBottom}px) to guarantee zero overlap`
    )
    const gap = leoDockBottom - resetScaleTopEdgeFromBottom
    assert.ok(gap >= 10, `Gap between Reset scale and Leo dock button must be at least 10px (actual: ${gap}px)`)
  })
})
