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
  { name: 'DEPLOY_MAP 完整性', run: () => {
    // ★ P0: 扫描 server/ 顶层和 server/core/ 下被 require 的本地 .js 文件，
    // 确保都在 deploy.py DEPLOY_MAP 中（防止生产环境 require 崩溃）
    // 教训：20260621 result-verifier.js 遗漏导致 L1/L2/L3 防漂移失效 7 天
    const path = require('path');

    // 1. 解析 deploy.py DEPLOY_MAP，提取 server/ 路径条目
    const deployContent = fs.readFileSync('deploy.py', 'utf8');
    const deployPaths = new Set();
    // 匹配 ('server/xxx/yyy.js', 'both'|'nginx'|'pm2')
    const entryRe = /\(\s*['"](server\/[^'"]+\.(?:js|cjs))['"]\s*,\s*['"][^'"]+['"]\s*\)/g;
    let m;
    while ((m = entryRe.exec(deployContent)) !== null) {
      // 标准化路径（去掉可能的 ./ 前缀）
      deployPaths.add(m[1].replace(/^\.\//, ''));
    }

    // 2. 只扫描生产核心目录：server/ 顶层 + server/core/（不递归 backfill/gongshoudao/payments 等手动工具目录）
    const scanDirs = ['server', 'server/core'];
    const requireRe = /require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;
    // 排除测试/mock/归档/手动工具
    const excludeFileRe = /(^|[\/\\])(tests?|__tests__|__mocks__|archive|backup_backfill)[\/\\]/i;
    const excludedNamePatterns = ['test_', '.test.js', '.spec.js', '_tmp_', 'batch_', 'diagnose_', 'catch_up', 'bulk_'];

    const requiredModules = new Set(); // server/ 相对路径
    const scannedFiles = [];

    for (const dir of scanDirs) {
      if (!fs.existsSync(dir)) continue;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isFile()) continue;
        if (!(ent.name.endsWith('.js') || ent.name.endsWith('.cjs'))) continue;
        const full = path.join(dir, ent.name);
        if (excludeFileRe.test(full)) continue;
        if (excludedNamePatterns.some(p => ent.name.includes(p))) continue;
        scannedFiles.push(full);
      }
    }

    // 3. 对每个扫描到的文件，按行提取 require('./xxx') 本地引用（跳过注释行）
    for (const file of scannedFiles) {
      let content;
      try { content = fs.readFileSync(file, 'utf8'); } catch (e) { continue; }
      const fileDir = path.dirname(file);
      const lines = content.split('\n');
      for (const line of lines) {
        // 跳过注释行：JSDoc(* )、行内(//)、块注释(/*)
        const trimmed = line.trim();
        if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
        // 移除行内注释后再匹配（防止 code // require('./x') 误匹配）
        const codePart = line.split('//')[0];
        let match;
        requireRe.lastIndex = 0;
        while ((match = requireRe.exec(codePart)) !== null) {
          const reqPath = match[1];
          // 解析为相对于项目根的路径
          const resolved = path.normalize(path.join(fileDir, reqPath));
          // 只关心 server/ 下的 .js 引用
          if (!resolved.startsWith('server')) continue;
          // require 可能省略 .js 扩展名，补全
          let normalized = resolved.replace(/\\/g, '/');
          if (!normalized.endsWith('.js') && !normalized.endsWith('.cjs') && !normalized.endsWith('.json')) {
            normalized += '.js';
          }
          requiredModules.add(normalized);
        }
      }
    }

    // 4. 对比：被 require 但不在 DEPLOY_MAP 中的模块
    const missing = [];
    for (const mod of requiredModules) {
      if (!deployPaths.has(mod)) {
        // 跳过非部署目标
        if (mod.includes('/tests/') || mod.includes('/__mocks__/') || mod.includes('/archive/')) continue;
        // 跳过 .json 数据文件（data.json 等在 PROTECTED_FILES 单独管理）
        if (mod.endsWith('.json')) continue;
        // 跳过手动工具脚本（非生产 require 链）
        if (mod.includes('batch_') || mod.includes('diagnose_') || mod.includes('test_') || mod.includes('catch_up') || mod.includes('bulk_')) continue;
        missing.push(mod);
      }
    }

    if (missing.length > 0) {
      // 去重排序
      const unique = [...new Set(missing)].sort();
      const msg = `${unique.length} 个被 require 的模块不在 DEPLOY_MAP 中:\n    ` + unique.join('\n    ') +
        '\n  → 需在 deploy.py DEPLOY_MAP 添加对应条目，否则生产环境 require 崩溃';
      throw new Error(msg);
    }
    console.log('  ✓ ' + scannedFiles.length + ' 个文件扫描，' + requiredModules.size + ' 个本地 require，0 个缺失');
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
