// ==================== Vite 构建配置 (Phase 2) ====================
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
  plugins: [{
    name: 'force-main-entry',
    enforce: 'pre',
    transformIndexHtml(html) {
      // 移除所有内联 module 脚本
      html = html.replace(/<script type="module">[\s\S]*?<\/script>/g, '');
      // 移除旧的 modulepreload 标签
      html = html.replace(/<link rel="modulepreload"[\s\S]*?\/>/g, '');
      // 确保 main-fusion.js 入口模块在 </head> 前
      if (!/<script type="module" src="\/js\/main-fusion\.js">/.test(html)) {
        html = html.replace('</head>',
          '  <script type="module" src="/js/main-fusion.js"></script>\n  </head>'
        );
      }
      return html;
    }
  }],
});
