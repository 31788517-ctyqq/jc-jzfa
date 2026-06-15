// ==================== Vite 构建配置 ====================
import { defineConfig } from 'vite';
export default defineConfig({
  root: 'preview',
  base: '/dist/',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: 'terser',
    target: 'es2015',
    modulePreload: { polyfill: false },
    cssCodeSplit: true,
  },
});
