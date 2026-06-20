/**
 * 从 JS 源码提取动态 CSS 类名生成 PurgeCSS safelist
 */
const fs = require('fs');
const path = require('path');

const SAFELIST = new Set();

// ── 硬编码必须保留的 ──
const HARDCODED = [
  // CSS 变量 & 设计 tokens
  ':root', '*', 'body', 'html',
  // 伪类/伪元素
  ':before', ':after', ':hover', ':focus', ':active', ':disabled', ':checked',
  ':first-child', ':last-child', ':nth-child', ':not', ':visited',
  '::-webkit-scrollbar', '::-webkit-scrollbar-thumb', '::-webkit-scrollbar-track',
  // 动画
  '@keyframes',
  // 媒体查询
  '@media',
  // 通用布局
  '.page', '.container', '.row', '.col',
  // Toast
  '.toast-info', '.toast-error', '.toast-success', '.toast-warning',
  // Loading
  '.loading-spinner', '.loading-text', '.loading',
  // Skeleton
  '.page-skeleton', '.skel-bar', '.skel-shimmer', '.w20', '.w40', '.w60', '.w80', '.w100',
  // Form elements
  'input', 'textarea', 'select', 'button', 'label', 'form',
  'input[type', '[type=', '.btn', '.btn-primary', '.btn-secondary',
  // Flex/Grid utilities
  '.flex', '.grid', '.gap',
  // Scrollbar hide
  '.scrollbar-hide',
];

HARDCODED.forEach(s => SAFELIST.add(s));

// ── 从 JS 文件扫描 class= 引用 ──
function scanFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    
    // 模式1: class="xxx" 或 class='xxx'
    const classAttr = content.match(/class=["']([^"']+)["']/g) || [];
    classAttr.forEach(m => {
      const classes = m.replace(/class=["']/, '').replace(/["']$/, '').split(/\s+/);
      classes.forEach(c => {
        if (c && c.length > 1 && !c.startsWith('{{') && !c.includes('$')) {
          SAFELIST.add('.' + c);
        }
      });
    });
    
    // 模式2: className: 'xxx' 或 className: "xxx"
    const className = content.match(/className:\s*["']([^"']+)["']/g) || [];
    className.forEach(m => {
      const val = m.replace(/className:\s*["']/, '').replace(/["']$/, '');
      const classes = val.split(/\s+/);
      classes.forEach(c => {
        if (c && c.length > 1 && !c.includes('$') && !c.includes('{')) {
          SAFELIST.add('.' + c);
        }
      });
    });
    
    // 模式3: querySelector/querySelectorAll('.xxx')
    const qsPattern = content.match(/querySelector(?:All)?\(["']\.([^"']+)["']\)/g) || [];
    qsPattern.forEach(m => {
      const val = m.match(/\.([^"')\s]+)/);
      if (val) SAFELIST.add('.' + val[1]);
    });
    
    // 模式4: ID selectors
    const idPattern = content.match(/getElementById\(["']([^"']+)["']\)/g) || [];
    idPattern.forEach(m => {
      const val = m.match(/'([^']+)'|"([^"]+)"/);
      if (val) SAFELIST.add('#' + (val[1] || val[2]));
    });
    
    // 模式5: CSS 变量 --jczj-*
    const varPattern = content.match(/--[\w-]+/g) || [];
    varPattern.forEach(v => SAFELIST.add(v));
  } catch (e) {}
}

// ── 扫描所有 JS 文件 ──
function walkDir(dir) {
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (item.name === 'node_modules' || item.name === '.git' || item.name.startsWith('_')) continue;
      walkDir(fullPath);
    } else if (item.name.endsWith('.js') || item.name.endsWith('.html')) {
      scanFile(fullPath);
    }
  }
}

walkDir('preview');
walkDir('.'); // root index.html

// ── 输出 ──
const list = Array.from(SAFELIST).sort();
console.log('// Auto-generated PurgeCSS safelist (' + list.length + ' entries)');
console.log('module.exports = ' + JSON.stringify(list, null, 2) + ';');

// 也保存到文件
fs.writeFileSync('scripts/safelist.json', JSON.stringify(list, null, 2));
console.log('\n// Saved to scripts/safelist.json');
