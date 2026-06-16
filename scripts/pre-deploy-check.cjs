// scripts/pre-deploy-check.cjs
// ★ 部署前强制验证，全部通过才能部署

const { execSync } = require('child_process');
const fs = require('fs');

let fatal = 0;
let warned = 0;

const checks = [
  { name: 'Lint', run: () => {
    execSync('npm run lint', { stdio: 'pipe', timeout: 60000 });
  }, fatal: true },
  { name: 'P0 Tests', run: () => {
    execSync('npm run test:p0 -- --forceExit', { stdio: 'pipe', timeout: 120000 });
  }, fatal: true },
  { name: 'P1 Tests', run: () => {
    execSync('npm run test:p1 -- --forceExit', { stdio: 'pipe', timeout: 120000 });
  }, fatal: false },
  { name: 'SW 无页面壳', run: () => {
    const sw = fs.readFileSync('preview/sw.js', 'utf8');
    if (sw.includes('PAGE_SHELL') || sw.includes("pathname === '/'"))
      throw new Error('SW 包含页面壳缓存');
  }, fatal: true },
  { name: 'Index 无 Vite dist 污染', run: () => {
    const html = fs.readFileSync('preview/index.html', 'utf8');
    if (html.includes('/dist/js/index') || html.includes('/dist/assets/'))
      throw new Error('preview/index.html 被 Vite dist 路径污染，应保持源路径');
  }, fatal: true },
  { name: 'Vite dist 构建就绪', run: () => {
    // ★ P0-2: 如果 dist/ 存在，验证其完整性
    if (!fs.existsSync('preview/dist/index.html')) return; // 未使用 Vite，跳过
    const distHtml = fs.readFileSync('preview/dist/index.html', 'utf8');
    if (!distHtml.includes('/dist/assets/'))
      throw new Error('dist/index.html 缺少 /dist/assets/ 引用，可能构建失败');
    if (distHtml.includes('/js/main-fusion.js') || distHtml.includes('/css/app.css'))
      throw new Error('dist/index.html 包含源路径引用，postbuild 可能失败');
    if (!distHtml.includes('critical-home'))
      console.warn('  ⚠️ dist/index.html 缺少关键 CSS 内联');
  }, fatal: true },
  { name: 'CSS Tokens', run: () => {
    const css = fs.readFileSync('preview/css/app.css', 'utf8');
    if (!css.includes('--jczj-brand'))
      console.warn('  ⚠️ CSS 未使用 Design Tokens（--jczj-* 变量缺失）');
  }, fatal: false },
  { name: 'datetime.js 存在', run: () => {
    if (!fs.existsSync('server/core/datetime.js'))
      console.warn('  ⚠️ datetime.js 不存在（时区工具未创建）');
  }, fatal: false },
  { name: 'deploy.py 编码(UTF-8)', run: () => {
    // ★ V12: deploy.py 必须是 UTF-8，不能是 UTF-16 LE（Python 无法解析）
    const buf = fs.readFileSync('deploy.py');
    if (buf[0] === 0xFF && buf[1] === 0xFE)
      throw new Error('deploy.py 是 UTF-16 LE! 转换为 UTF-8: python -c "src=open(\"deploy.py\",encoding=\"utf-16\").read();open(\"deploy.py\",\"w\",encoding=\"utf-8\").write(src)"');
    if (buf.length > 2 && buf[0] !== 0x23 && buf[1] !== 0x20 && buf[0] !== 0x69)
      console.warn('  ⚠️ deploy.py 首字节异常，检查编码');
  }, fatal: true },
];

console.log('🔍 部署前验证中...\n');

checks.forEach(c => {
  try {
    c.run();
    console.log('✅ ' + c.name);
  } catch (e) {
    if (c.fatal) { console.error('❌ ' + c.name + ': ' + e.message); fatal++; }
    else { console.warn('⚠️ ' + c.name + ': ' + e.message); warned++; }
  }
});

console.log('');
if (fatal > 0) {
  console.error('❌ ' + fatal + ' 个阻断检查未通过，禁止部署\n');
  process.exit(1);
}
if (warned > 0) console.warn('⚠️ ' + warned + ' 个警告（非阻断）');
console.log('✅ 全部阻断检查通过，可以部署\n');
