/**
 * PurgeCSS — 清理所有 preview/css/*.css 文件
 * 用法: node scripts/purge_css.cjs [--restore]
 */
const { PurgeCSS } = require('purgecss');
const fs = require('fs');
const path = require('path');
const safelist = require('./safelist.json');

const CSS_DIR = 'preview/css';
const CSS_FILES = fs.readdirSync(CSS_DIR).filter(f =>
  f.endsWith('.css') && !f.includes('.bak') && !f.includes('.br') && !f.includes('pre_purge') && f !== 'app-legacy.css'
);

// 恢复备份
if (process.argv.includes('--restore')) {
  for (const f of CSS_FILES) {
    const fp = path.join(CSS_DIR, f);
    const bak = fp + '.pre_purge';
    if (fs.existsSync(bak)) {
      fs.copyFileSync(bak, fp);
      console.log('Restored:', f);
    }
  }
  console.log('Done');
  process.exit(0);
}

async function run() {
  console.log(`[purge] ${CSS_FILES.length} CSS files...\n`);

  const results = await new PurgeCSS().purge({
    content: [
      'preview/js/**/*.js',
      'preview/**/*.html',
      'index.html',
    ],
    css: CSS_FILES.map(f => path.join(CSS_DIR, f)),
    safelist: {
      standard: safelist,
      deep: [/^data-/, /^aria-/],
      greedy: [/^swal/],
    },
    keyframes: true,
    fontFace: true,
    variables: true,
    rejected: false,
  });

  let totalOrig = 0, totalPurged = 0;
  
  for (const r of results) {
    const fp = r.file;
    if (!fp) continue;
    const orig = fs.statSync(fp).size;
    totalOrig += orig;
    
    if (!r.css || r.css.trim().length < 100) {
      console.log(`  SKIP ${path.basename(fp)} (would be empty)`);
      continue;
    }
    
    // 备份
    const bak = fp + '.pre_purge';
    if (!fs.existsSync(bak)) fs.copyFileSync(fp, bak);
    
    fs.writeFileSync(fp, r.css);
    const purged = fs.statSync(fp).size;
    totalPurged += purged;
    const pct = ((1 - purged / orig) * 100).toFixed(1);
    console.log(`  ${path.basename(fp)}: ${(orig/1024).toFixed(0)}→${(purged/1024).toFixed(0)}KB (${pct > 0 ? '-' + pct : ''}%)`);
  }

  console.log(`\nTotal: ${(totalOrig/1024).toFixed(0)}→${(totalPurged/1024).toFixed(0)}KB (-${totalOrig>0?((1-totalPurged/totalOrig)*100).toFixed(1):0}%)`);
  console.log('Backups: *.pre_purge  (node scripts/purge_css.cjs --restore to undo)');
}

run().catch(e => console.error(e.message));
