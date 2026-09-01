import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Emit a self-contained Node server at `dist/standalone/server.js`.
  //
  // This is what the production container runs. The bundle carries its own
  // `node_modules` (runtime dependencies only), so the runtime image needs no
  // package manager, no dev dependencies and no source checkout.
  //
  // Start it with: node dist/standalone/server.js  (PORT / HOST are read from env)
  output: 'standalone',
};

export default nextConfig;
