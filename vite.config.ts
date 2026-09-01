import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import fs from 'node:fs';
import { defineConfig, type PluginOption } from 'vite';

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

// Build target.
//
//   node       (default) -> plain Vite/Node build. Combined with
//                           `output: 'standalone'` in next.config.ts this emits
//                           dist/standalone/, which the Docker image serves.
//   cloudflare           -> original Cloudflare Workers build, kept so the app
//                           can still be deployed to Workers if wanted.
//
// Self-hosting on TrueNAS uses the `node` target, so that is the default.
const deployTarget = process.env.DEPLOY_TARGET ?? 'node';

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

/**
 * Build the Cloudflare Workers plugin.
 *
 * Loaded lazily and only for the `cloudflare` target: Wrangler snapshots its
 * log path while the plugin is imported, and the Node build must not pull in
 * workerd at all. `.openai/hosting.json` is read here rather than imported at
 * module scope so the Node build does not depend on that file existing.
 */
async function cloudflarePlugin(): Promise<PluginOption> {
  const { d1, r2 } = JSON.parse(
    fs.readFileSync(new URL('./.openai/hosting.json', import.meta.url), 'utf-8'),
  ) as { d1: string | null; r2: string | null };

  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return cloudflare({
    viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
    config: {
      main: 'vinext/server/fetch-handler',
      compatibility_flags: ['nodejs_compat'],
      d1_databases: d1
        ? [
            {
              binding: d1,
              database_name: 'site-creator-d1',
              database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
            },
          ]
        : [],
      r2_buckets: r2
        ? [
            {
              binding: r2,
              bucket_name: 'site-creator-r2',
            },
          ]
        : [],
    },
  });
}

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  const plugins: PluginOption[] = [vinext(), sites()];

  if (deployTarget === 'cloudflare') {
    plugins.push(await cloudflarePlugin());
  }

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    server: {
      host: '0.0.0.0',
      port: Number(process.env.APP_PORT ?? 3000),
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins,
  };
});
