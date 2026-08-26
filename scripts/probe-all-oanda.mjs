const apiKey = "02ee0aa2a276cff3836cd678522da4e6-b7390c37ff998e2e16bd12c12b209015"

async function probe(envLabel, baseUrl) {
  console.log(`--- Probing ${envLabel} (${baseUrl}) ---`)
  try {
    const res = await fetch(`${baseUrl}/v3/accounts`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    })
    console.log('Accounts Status:', res.status)
    const text = await res.text()
    console.log('Response:', text)
  } catch (err) {
    console.error('Error:', err.message)
  }
}

async function run() {
  await probe('Practice', 'https://api-fxpractice.oanda.com')
  await probe('Live', 'https://api-fxtrade.oanda.com')
}

run()
