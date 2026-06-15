// ==================== Vite 轻量构建配置 (Phase 2) ====================
// 目标：Tree-shaking + Minify + Content Hash + 保持页面模块独立（lazy-load）
// 构建入口：preview/index.html → 输出：preview/dist/

import { defineConfig } from 'vite';

export default defineConfig({
  root: 'preview',
  base: '/dist/',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'js/[name]-[hash:8].js',
        chunkFileNames: 'js/[name]-[hash:8].js',
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name || 'asset';
          if (name.endsWith('.css')) return 'css/[name]-[hash:8][extname]';
          return 'assets/[name]-[hash:8][extname]';
        },
      },
    },
    minify: 'terser',
    target: 'es2015',
    modulePreload: { polyfill: false },
    cssCodeSplit: true,
  },
});
