import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Backend URLs for the dev proxy (override to run against a second local stack on other ports).
const GATEWAY = process.env.DEV_GATEWAY_URL || 'http://localhost:3000';
const POLICY_ENGINE = process.env.DEV_POLICY_ENGINE_URL || 'http://localhost:3001';
const ANALYTICS = process.env.DEV_ANALYTICS_URL || 'http://localhost:3003';

export default defineConfig({
  plugins: [react()],
  // amazon-cognito-identity-js expects Node's `global`; point it at the browser's globalThis.
  define: { global: 'globalThis' },
  server: {
    port: Number(process.env.DEV_PORT) || 5174,
    proxy: {
      // More specific routes FIRST
      // Only /api/… goes to the gateway; app pages like /api-keys must not match.
      '^/api/': {
        target: GATEWAY,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/analytics': {
        target: ANALYTICS,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/analytics/, ''),
      },
      // Health check proxies for Platform Health page
      '/health/gateway': {
        target: GATEWAY,
        changeOrigin: true,
        rewrite: () => '/health',
      },
      '/health/policy-engine': {
        target: POLICY_ENGINE,
        changeOrigin: true,
        rewrite: () => '/health',
      },
      '/health/analytics': {
        target: ANALYTICS,
        changeOrigin: true,
        rewrite: () => '/health',
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test-setup.ts',
  },
});
