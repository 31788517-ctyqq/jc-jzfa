// Fix main-fusion.js: remove import.meta.glob, clean BOM, remove version stamps
var fs = require('fs');
var path = require('path');
var fp = path.resolve(__dirname, '../preview/js/main-fusion.js');
var c = fs.readFileSync(fp, 'utf8');

// Remove BOM
c = c.replace(/^\uFEFF/, '');

// Remove version stamps
c = c.replace(/\?v=\d{10,12}/g, '');

// Replace import.meta.glob pattern with simple dynamic import
// Pattern: const _pageModules = import.meta.glob('./pages/*.js');\nfunction _mod(name) { ... }
c = c.replace(
  /const _pageModules = import\.meta\.glob\('\.\/pages\/\*\.js'\);\s*function _mod\(name\) \{\s*const key = '\.\/pages\/' \+ name \+ '\.js';\s*const loader = _pageModules\[key\];\s*if \(!loader\) \{\s*console\.error\('[^)]+'\);\s*return Promise\.reject\(new Error\('[^)]+'\)\);\s*\}\s*return loader\(\)/,
  "function _mod(name) {\n  return import('./pages/' + name + '.js')"
);

// Remove stale comments about import.meta.glob
c = c.replace(/\/\/ ═══ 模块懒加载：import\.meta\.glob[\s\S]*?独立 chunk ═══\s*\/\/ ★ Phase2 \(Vite\): import\.meta\.glob[\s\S]*?自动 Code-Split\s*\/\/\s*每个页面模块成为独立 chunk，Tree-Shaking 移除未用导出\s*/, '');

console.log('size:', c.length);
console.log('has import.meta:', c.includes('import.meta'));

fs.writeFileSync(fp, c, 'utf8');
