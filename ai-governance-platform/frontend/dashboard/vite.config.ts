import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      // More specific routes FIRST
      '/api/compliance': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/compliance/, '/v1/compliance'),
      },
      '/api/policies': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/policies/, '/v1/policies'),
      },
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/analytics': {
        target: 'http://localhost:3003',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/analytics/, ''),
      },
      '/scanner': {
        target: 'http://localhost:3004',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/scanner/, ''),
      },
      // Health check proxies for Platform Health page
      '/health/gateway': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: () => '/health',
      },
      '/health/policy-engine': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: () => '/health',
      },
      '/health/analytics': {
        target: 'http://localhost:3003',
        changeOrigin: true,
        rewrite: () => '/health',
      },
      '/health/content-scanner': {
        target: 'http://localhost:3004',
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
