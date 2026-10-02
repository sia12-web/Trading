import { fetchLiveWatcherSession } from '../lib/trading/questradeWatcherSync'

async function test() {
  try {
    const session = await fetchLiveWatcherSession()
    console.log('watcher session:', session ? { ...session, accessToken: session.accessToken.slice(0, 10) + '...' } : null)
  } catch (e) {
    console.error('Error:', e)
  }
}
test()
