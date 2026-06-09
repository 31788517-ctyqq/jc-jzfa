/**
 * 部署依赖扫描器 — 检查 deploy_gs.bat 是否遗漏外部依赖
 *
 * 扫描逻辑:
 *   1. 解析 deploy_gs.bat 中上传的 gongshoudao/*.js 文件列表
 *   2. 对每个文件扫描 require() 引用（只关注相对路径 ../xxx 的外部依赖）
 *   3. 检查这些依赖是否在 deploy_gs.bat 或 deploy.py DEPLOY_MAP 覆盖范围内
 *   4. 报告遗漏的依赖
 *
 * 用法: node scripts/check-deploy-deps.js [--deploy-gs-only] [--json]
 *
 * 退出码:
 *   0 - 无遗漏依赖
 *   1 - 发现遗漏依赖（阻断部署）
 *   2 - 扫描过程出错
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const GONGSOUDAO_DIR = path.join(PROJECT_ROOT, 'server', 'gongshoudao');
const DEPLOY_GS = path.join(PROJECT_ROOT, 'deploy_gs.bat');
const DEPLOY_PY = path.join(PROJECT_ROOT, 'deploy.py');

// ── 颜色输出 ──
const C = process.env.NO_COLOR
  ? {}
  : {
      R: '\x1b[91m',
      G: '\x1b[92m',
      Y: '\x1b[93m',
      C: '\x1b[96m',
      B: '\x1b[0m',
      D: '\x1b[2m',
    };
function c(color, text) {
  if (!process.env.NO_COLOR) return (C[color] || '') + text + C.B;
  return text;
}

const outputJSON = process.argv.includes('--json');
const gsOnly = process.argv.includes('--deploy-gs-only');

// ── 1) 解析 deploy_gs.bat 上传的文件 ──
function parseDeployGS() {
  if (!fs.existsSync(DEPLOY_GS)) {
    console.error(c('R', '✗ deploy_gs.bat 未找到'));
    return [];
  }
  const content = fs.readFileSync(DEPLOY_GS, 'utf8');
  const files = new Set();

  // 匹配 server\gongshoudao\xxx.js 格式
  const gsRe = /server\\gongshoudao\\([\w-]+\.js)/g;
  let match;
  while ((match = gsRe.exec(content)) !== null) {
    files.add(match[1]);
  }
  return Array.from(files);
}

// ── 2) 解析 deploy.py DEPLOY_MAP 中 core/ 相关文件 ──
function parseDeployPyCore() {
  if (!fs.existsSync(DEPLOY_PY)) return [];

  const content = fs.readFileSync(DEPLOY_PY, 'utf8');
  const coreFiles = [];

  // 匹配 DEPLOY_MAP 中 server/core/*.js 条目
  const re = /server\/core\/([\w-]+\.js)/g;
  let match;
  while ((match = re.exec(content)) !== null) {
    coreFiles.push(match[1]);
  }
  return coreFiles;
}

// ── 3) 扫描 gongshoudao JS 文件中的外部 require() ──
function scanExternalRequires(fileList) {
  /** @type {Map<string, string[]>} file -> [dep1, dep2, ...] */
  const depMap = new Map();

  for (const fname of fileList) {
    const filePath = path.join(GONGSOUDAO_DIR, fname);
    if (!fs.existsSync(filePath)) {
      if (!outputJSON) console.log(c('Y', '  ⚠ 文件不存在（跳过）: ' + fname));
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const deps = [];

    // 匹配 require('...') 或 require("...") — 只关注 ../ 开头的相对路径（外部依赖）
    const reqRe = /require\(['"]([^'"]+)['"]\)/g;
    let m;
    while ((m = reqRe.exec(content)) !== null) {
      const modulePath = m[1];
      // 只跟踪 ../ 相对路径（跳出 gongshoudao/ 目录的外部依赖）
      if (modulePath.startsWith('../')) {
        // 解析绝对路径
        const resolved = path.resolve(path.dirname(filePath), modulePath);
        // 计算相对于 server/ 的路径
        const relToServer = path.relative(path.join(PROJECT_ROOT, 'server'), resolved);
        if (!relToServer.startsWith('..')) {
          // 将路径标准化为 server/core/xxx.js 格式
          const normalized = relToServer.replace(/\\/g, '/');
          deps.push(normalized);
        }
      }
    }

    if (deps.length > 0) {
      depMap.set(fname, deps);
    }
  }

  return depMap;
}

// ── 4) 对比检查 ──
function check(depMap, gsFiles, deployPyCore) {
  const missing = [];
  const covered = [];

  const gsSet = new Set(gsFiles);
  const coreSet = new Set(deployPyCore);

  for (const [fname, deps] of depMap.entries()) {
    for (const dep of deps) {
      // 检查依赖是否在 deploy.py DEPLOY_MAP core/ 中
      const depBasename = path.basename(dep);
      const inDeployPy = coreSet.has(depBasename);

      // 检查依赖是否在 deploy_gs.bat 中有额外上传（通过 scp 命令直接传 core/ 文件）
      // deploy_gs.bat 中可能通过单独的 scp 命令上传 core/ 文件
      let inDeployGS = false;
      if (fs.existsSync(DEPLOY_GS)) {
        const gsContent = fs.readFileSync(DEPLOY_GS, 'utf8');
        // 检查是否有 scp server\\core\\xxx.js 或 server/core/xxx.js
        if (gsContent.includes(dep) || gsContent.includes(dep.replace(/\//g, '\\\\'))) {
          inDeployGS = true;
        }
      }

      if (inDeployPy || inDeployGS) {
        covered.push({ file: fname, dep, source: inDeployGS ? 'deploy_gs.bat' : 'deploy.py(DEPLOY_MAP)' });
      } else {
        missing.push({ file: fname, dep });
      }
    }
  }

  return { missing, covered };
}

// ── 主流程 ──
function main() {
  if (!outputJSON) {
    console.log(c('D', '═'.repeat(60)));
    console.log(c('C', ' JC-ZJFA 部署依赖扫描器'));
    console.log(c('D', '═'.repeat(60)));
  }

  // 1. 解析 deploy_gs.bat
  const gsFiles = parseDeployGS();
  if (gsFiles.length === 0) {
    if (gsOnly) {
      console.log(c('Y', 'deploy_gs.bat 中未找到 gongshoudao 文件，跳过检查'));
      return 0;
    }
  }

  if (!outputJSON) {
    console.log(c('D', '\n[1] deploy_gs.bat 覆盖的 gongshoudao 文件: ' + gsFiles.length + ' 个'));
    gsFiles.forEach((f) => console.log('      - ' + f));
  }

  // 2. 解析 deploy.py core/ 覆盖
  const deployPyCore = parseDeployPyCore();
  if (!outputJSON) {
    console.log(c('D', '\n[2] deploy.py 覆盖的 core/ 文件: ' + deployPyCore.length + ' 个'));
  }

  // 3. 扫描外部 require() 依赖
  const depMap = scanExternalRequires(gsFiles);
  if (!outputJSON && depMap.size > 0) {
    console.log(c('D', '\n[3] 发现外部依赖:'));
    for (const [f, deps] of depMap.entries()) {
      console.log('      ' + f + ' → ' + deps.join(', '));
    }
  }

  // 4. 对比
  const { missing, covered } = check(depMap, gsFiles, deployPyCore);

  if (!outputJSON) {
    if (covered.length > 0) {
      console.log(c('D', '\n[4] 已覆盖的依赖:'));
      covered.forEach((r) =>
        console.log('      ' + c('G', '✓') + ' ' + r.file + ' → ' + r.dep + ' [' + r.source + ']'),
      );
    }
  }

  if (outputJSON) {
    console.log(JSON.stringify({ missing, covered, gsFiles, deployPyCore }, null, 2));
  }

  if (missing.length > 0) {
    const msg = missing.map((r) => r.file + ' → ' + r.dep).join('; ');
    const fullMsg = missing
      .map((r) => '  ✗ ' + r.file + ' 依赖 ' + r.dep + ' — 不在 deploy_gs.bat 或 deploy.py 覆盖范围内')
      .join('\n');

    if (!outputJSON) {
      console.log('\n' + c('R', '[!] 发现 ' + missing.length + ' 个遗漏依赖！'));
      console.log(c('R', '这些文件不在部署范围内，部署后会导致 require() 失败：'));
      console.log(fullMsg);
      console.log('');
      console.log(c('Y', '修复方法: 在 deploy_gs.bat 中添加以下 scp 命令:'));
      for (const m of missing) {
        console.log(
          c(
            'C',
            '  scp server\\' +
              m.dep.replace(/\//g, '\\') +
              ' root@119.23.51.159:/root/server/' +
              path.dirname(m.dep).replace(/\\/g, '/') +
              '/',
          ),
        );
      }
    }

    return 1;
  }

  if (!outputJSON) {
    console.log('\n' + c('G', '✅ 依赖检查全部通过 — 共 ' + gsFiles.length + ' 个文件，外部依赖均已覆盖'));
  }

  return 0;
}

process.exitCode = main();
if (process.exitCode > 0) process.exit(process.exitCode);
