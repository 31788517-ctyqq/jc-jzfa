// scripts/pre-commit-check.cjs
// ★ 每次 git commit 前自动执行，阻断已知犯错模式

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let errors = 0;
const ROOT = path.resolve(__dirname, '..');

function getStagedJS() {
  try {
    const staged = execSync('git diff --cached --name-only', { encoding: 'utf8' });
    return staged.split('\n').filter(f => f.endsWith('.js') && f.startsWith('server/'));
  } catch (e) { return []; }
}

// 检查 1: 是否绕过 database adapter 直接写 raw
function checkRawBypass() {
  const files = getStagedJS();
  files.forEach(f => {
    const fp = path.join(ROOT, f);
    if (!fs.existsSync(fp)) return;
    const content = fs.readFileSync(fp, 'utf8');
    if (content.includes('database.getDatabase()') &&
        (content.includes('.run(') || content.includes('.exec(') || content.includes('.prepare('))) {
      console.error(`❌ [禁止] ${f}: 绕过 database.getAdapter() 直接写 raw 实例`);
      errors++;
    }
  });
}

// 检查 2: 是否使用 UTC 日期而非北京时间
function checkTimezone() {
  const files = getStagedJS();
  files.forEach(f => {
    const fp = path.join(ROOT, f);
    if (!fs.existsSync(fp)) return;
    const content = fs.readFileSync(fp, 'utf8');
    if (content.includes("new Date().toISOString().slice(0,10)") ||
        content.includes("new Date().toISOString().split('T')")) {
      console.error(`❌ [禁止] ${f}: 使用 UTC 日期 → 改用 datetime.todayCN()`);
      errors++;
    }
  });
}

// 检查 3: SW 是否缓存了 HTML 壳
function checkSW() {
  try {
    const sw = fs.readFileSync(path.join(ROOT, 'preview/sw.js'), 'utf8');
    if (sw.includes('PAGE_SHELL') || sw.includes("pathname === '/'")) {
      console.error('❌ [禁止] sw.js: 包含页面壳缓存逻辑');
      errors++;
    }
  } catch (e) {}
}

// 检查 4: index.html 是否被 Vite dist 污染
function checkIndexHtml() {
  try {
    const html = fs.readFileSync(path.join(ROOT, 'preview/index.html'), 'utf8');
    if (html.includes('/dist/js/index')) {
      console.error('❌ [禁止] index.html: 包含 Vite dist 路径污染');
      errors++;
    }
  } catch (e) {}
}

// 检查 5: 是否新增了临时脚本
function checkTempScripts() {
  try {
    const staged = execSync('git diff --cached --name-only', { encoding: 'utf8' });
    const tempPatterns = ['_probe', '_diag', '_slow', 'fix_', 'restore_', 'patch_'];
    staged.split('\n').forEach(f => {
      const bn = path.basename(f);
      tempPatterns.forEach(p => {
        if (bn.includes(p) && !f.startsWith('scripts/perf/')) {
          console.error(`❌ [禁止] ${f}: 临时脚本不应提交`);
          errors++;
        }
      });
    });
  } catch (e) {}
}

// 检查 6: 新增 server/ 模块是否在 deploy.py 中
function checkDeployDeps() {
  try {
    const staged = execSync('git diff --cached --name-status', { encoding: 'utf8' });
    const added = staged.split('\n').filter(l => l.startsWith('A\t')).map(l => l.replace('A\t', ''));
    const deployContent = fs.readFileSync(path.join(ROOT, 'deploy.py'), 'utf8');
    added.forEach(f => {
      if (f.startsWith('server/') && !f.includes('tests/') && !f.includes('node_modules/')) {
        const bn = path.basename(f);
        if (!deployContent.includes(bn)) {
          console.warn(`⚠️ [提醒] ${f}: 未在 deploy.py 中找到，部署时可能遗漏`);
        }
      }
    });
  } catch (e) {}
}

// 执行
console.log('🔍 Pre-commit 检查中...\n');
checkRawBypass();
checkTimezone();
checkSW();
checkIndexHtml();
checkTempScripts();
checkDeployDeps();

if (errors > 0) {
  console.error(`\n❌ 发现 ${errors} 个问题，提交被阻断。\n`);
  process.exit(1);
}
console.log('✅ 全部检查通过\n');
