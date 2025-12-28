import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],

  server: {
    port: 5173,
    // Proxy WebSocket to the backend server
    proxy: {
      '/ws': {
        target: 'ws://localhost:7890',
        ws: true,
      },
      '/ecp': {
        target: 'ws://localhost:7890',
        ws: true,
      },
    },
  },

  build: {
    outDir: 'dist',
    sourcemap: true,
    // Optimize Monaco Editor chunks
    rollupOptions: {
      output: {
        manualChunks: {
          'monaco-editor': ['monaco-editor'],
          xterm: ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-webgl'],
        },
      },
    },
  },

  optimizeDeps: {
    include: ['monaco-editor', '@xterm/xterm'],
  },
});
