// Minimal service worker — unregisters itself to prevent 404 errors
// This file exists solely to stop the browser from spamming 404 for sw.js
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', () => {
  self.registration.unregister()
    .then(() => self.clients.matchAll())
    .then(clients => clients.forEach(client => client.navigate(client.url)))
})
