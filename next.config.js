/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,

  // Do NOT put NEXT_PUBLIC_* in `env` here — that inlines build-time values
  // (often empty on Railway) and breaks runtime even after vars are set.
  // Next.js already exposes NEXT_PUBLIC_* from the environment.

  // Optimize images
  images: {
    remotePatterns: [],
  },

  // Headers for security
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
        ],
      },
    ]
  },

  // Redirect insecure URLs
  async redirects() {
    return [
      {
        source: '/index.html',
        destination: '/',
        permanent: true,
      },
    ]
  },
}

module.exports = nextConfig
