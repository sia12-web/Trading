const apiKey = "a71aa7a75f97def0d971f1657d8e5c05-182ccb08f3df0906d32ac7d942afeb13"
const accountId = "001-002-17823794-001"

async function testLive() {
  console.log('--- Testing Fresh Live API Key on OANDA fxtrade ---')
  try {
    const res = await fetch(`https://api-fxtrade.oanda.com/v3/accounts/${accountId}/summary`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    })
    console.log('HTTP Status:', res.status)
    const text = await res.text()
    console.log('Response:', text)
  } catch (err) {
    console.error('Error:', err.message)
  }
}

testLive()
