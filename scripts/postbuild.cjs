// Postbuild: 将构建产物注入 index.html
const fs = require('fs');
const path = require('path');

const distDir = path.resolve(__dirname, '../preview/dist');

function findAllFiles(dir, ext) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const full = path.join(dir, item);
    const st = fs.statSync(full);
    if (st.isDirectory() && item !== 'node_modules') {
      results.push(...findAllFiles(full, ext));
    } else if (st.isFile() && full.endsWith(ext)) {
      results.push({
        name: item,
        relPath: path.relative(distDir, full).replace(/\\/g, '/'),
        size: st.size
      });
    }
  }
  return results;
}

const jsFiles = findAllFiles(distDir, '.js');
const cssFiles = findAllFiles(distDir, '.css').filter(f => !f.name.includes('admin-v2'));

// 页面 chunk 名称列表
const PAGE_NAMES = ['vendor', 'home', 'match-list', 'match-detail', 'ranking', 'plans', 'hit-rate',
  'backtest', 'filter', 'income', 'scheme-design', 'quant-rank', 'quant-rank-fusion',
  'login', 'register', 'profile', 'pricing', 'payment', 'subscription', 'referral',
  'admin', 'admin-payments', 'admin-referrals', 'confirm-scheme', 'model-dashboard',
  'data-health', 'my-plan', 'match-pk', 'match-pk-fusion', 'gongshoudao', 'betting',
  'account-security', 'contact-invite', 'payment-result', 'main-fusion'
];

function isPageChunk(name) {
  return PAGE_NAMES.some(n => name.includes(n));
}

// 构建 modulepreload 列表
const preloadChunks = jsFiles.filter(f => isPageChunk(f.name));
const preloadTags = preloadChunks
  .map(f => '    <link rel="modulepreload" href="/dist/' + f.relPath + '" />')
  .join('\n');

// 读取源 HTML
const srcHtml = path.resolve(__dirname, '../preview/index.html');
let html = fs.readFileSync(srcHtml, 'utf8');

// 清理所有 ?v= 版本戳
html = html.replace(/\?v=\d{10,12}/g, '');

// 清理旧 modulepreload 标签（Vite 可能从源 HTML 重新注入）
html = html.replace(/<link rel="modulepreload" href="\/js\/[^"]*"[^>]*\/>/g, '');

// 替换 CSS 引用
const appCss = cssFiles.find(f => f.name.includes('app') || f.name.includes('index-'));
const modalsCss = cssFiles.find(f => f.name.includes('modals'));
const bettingCss = cssFiles.find(f => f.name.includes('betting'));

if (appCss) html = html.replace(/\/css\/app\.css/g, '/dist/' + appCss.relPath);
if (modalsCss) html = html.replace(/\/css\/modals\.css/g, '/dist/' + modalsCss.relPath);
if (bettingCss) html = html.replace(/\/css\/betting\.css/g, '/dist/' + bettingCss.relPath);

// 替换 JS 入口
html = html.replace(
  /<script type="module" src="\/js\/main-fusion\.js"><\/script>/g,
  '<script type="module" crossorigin src="/dist/' + preloadChunks.find(f => f.name.includes('main-fusion')).relPath + '"></script>'
);

// 移除内联 module
html = html.replace(/<script type="module">[\s\S]*?<\/script>/g, '');

// 注入 modulepreload
const headEnd = html.indexOf('</head>');
if (headEnd > 0 && preloadTags) {
  html = html.slice(0, headEnd) + preloadTags + '\n  ' + html.slice(headEnd);
}

// 写入 dist/
const distHtml = path.join(distDir, 'index.html');
fs.writeFileSync(distHtml, html, 'utf8');

console.log('[postbuild] entry: dist/' + (preloadChunks.find(f => f.name.includes('main-fusion')) || {}).relPath);
console.log('[postbuild] preload: ' + preloadChunks.length + ' chunks (' + preloadChunks.map(f => f.name).join(', ') + ')');
console.log('[postbuild] CSS: dist/' + ((appCss && appCss.relPath) || 'N/A'));
