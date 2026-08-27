async function checkYahoo() {
  const symbols = ['^DJI', '^NDX', '^N225']
  for (const s of symbols) {
    const res = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${s}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    })
    const json = await res.json()
    const r = json?.quoteResponse?.result?.[0]
    console.log(s, ':', r?.regularMarketPrice, r?.shortName)
  }
}
checkYahoo()
