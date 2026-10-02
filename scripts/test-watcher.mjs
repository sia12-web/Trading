import { fetchLiveWatcherSession } from './lib/trading/questradeWatcherSync.ts';

async function test() {
  const session = await fetchLiveWatcherSession();
  console.log('watcher session:', session ? { ...session, accessToken: session.accessToken.slice(0, 10) + '...' } : null);
}
test();
