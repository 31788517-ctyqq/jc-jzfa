/**
 * Brotli 预压缩脚本 — Vite 构建后执行
 * 为 .js/.css/.html/.svg 文件生成 .br 副本
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TARGET_DIRS = [
  'preview/dist',
  'preview/css',
  'preview/js',
  // 根目录 HTML
];

const EXTENSIONS = ['.js', '.css', '.html', '.svg', '.json'];
const MIN_SIZE = 256; // 小于此不压缩
const QUALITY = 11;   // 最高压缩

let totalFiles = 0;
let totalBytes = 0;
let totalBrBytes = 0;

function compressFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!EXTENSIONS.includes(ext)) return;
  
  const stat = fs.statSync(filePath);
  if (stat.size < MIN_SIZE) return;
  
  const brPath = filePath + '.br';
  
  // Skip if .br already up-to-date
  try {
    const brStat = fs.statSync(brPath);
    if (brStat.mtime >= stat.mtime) return;
  } catch (e) { /* not exists */ }
  
  try {
    const input = fs.readFileSync(filePath);
    const compressed = zlib.brotliCompressSync(input, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: QUALITY }
    });
    fs.writeFileSync(brPath, compressed);
    
    totalFiles++;
    totalBytes += stat.size;
    totalBrBytes += compressed.length;
    
    const ratio = ((1 - compressed.length / stat.size) * 100).toFixed(1);
    console.log(`  ✓ ${path.relative('.', filePath)} (${stat.size}→${compressed.length}B, -${ratio}%)`);
  } catch (err) {
    console.error(`  ✗ ${filePath}: ${err.message}`);
  }
}

function walkDir(dir) {
  if (!fs.existsSync(dir)) return;
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (item.name === 'node_modules' || item.name === '.git') continue;
      walkDir(fullPath);
    } else if (item.isFile()) {
      compressFile(fullPath);
    }
  }
}

function compressRootHtml(dir) {
  // Compress root-level index.html and adm.html
  ['index.html', 'preview/index.html', 'preview/adm.html'].forEach(f => {
    if (fs.existsSync(f)) compressFile(f);
  });
}

console.log('🔧 Brotli pre-compression (quality=' + QUALITY + ')...\n');

for (const dir of TARGET_DIRS) {
  walkDir(dir);
}
compressRootHtml('.');

console.log(`\n✅ ${totalFiles} files compressed`);
console.log(`   Original: ${(totalBytes/1024).toFixed(0)} KB → Brotli: ${(totalBrBytes/1024).toFixed(0)} KB (${totalBytes>0?((1-totalBrBytes/totalBytes)*100).toFixed(1):0}% saved)`);
