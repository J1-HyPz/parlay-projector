import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    // Without this, a client-side navigation that fails is swallowed: the Link
    // shim calls preventDefault() and then does nothing, so the click appears
    // dead while middle-click still works. Enabling it falls back to a real
    // navigation instead. Defaults to false in vinext.
    appNavFailHandling: true,
  },

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
