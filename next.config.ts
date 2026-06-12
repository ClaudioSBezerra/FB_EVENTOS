import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Required by docker/Dockerfile (multi-stage build copies .next/standalone).
  // See RESEARCH.md Pattern 11.
  output: 'standalone',
}

export default nextConfig
