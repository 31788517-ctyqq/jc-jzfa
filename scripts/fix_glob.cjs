// Fix: remove import.meta.glob, replace with dynamic import()
var fs = require('fs');
var path = require('path');

var filePath = path.resolve(__dirname, '../preview/js/main-fusion.js');
var content = fs.readFileSync(filePath, 'utf8');

// Find and replace the import.meta.glob pattern with simple import()
var oldPattern = /const _pageModules = import\.meta\.glob\('\.\/pages\/\*\.js'\);function _mod\(name\) {[\s\S]*?return loader\(\)\.catch[\s\S]*?}  \);  }\);  }\);/;

var replacement = `function _mod(name) {
  return import('./pages/' + name + '.js').catch(function (e) {
    console.error('[JS] 模块加载失败: ' + name + ' - ' + (e && e.message));
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        import('./pages/' + name + '.js').then(resolve).catch(function (e2) {
          console.error('[JS] 模块重试也失败: ' + name + ' - ' + (e2 && e2.message));
          reject(e2);
        });
      }, 1000);
    });
  });
}`;

if (oldPattern.test(content)) {
  content = content.replace(oldPattern, replacement);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('SUCCESS: import.meta.glob replaced with dynamic import()');
} else {
  // Try a simpler approach - just replace the const _pageModules line and simplify _mod
  var lines = content.split('\n');
  var newLines = [];
  var skipUntilEndOfMod = false;
  var braceCount = 0;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.includes('const _pageModules = import.meta.glob')) {
      // Replace with simplified _mod
      newLines.push('function _mod(name) {');
      newLines.push('  return import(\'./pages/\' + name + \'.js\').catch(function (e) {');
      newLines.push('    console.error(\'[JS] 模块加载失败: \' + name + \' - \' + (e && e.message));');
      newLines.push('    return new Promise(function (resolve, reject) {');
      newLines.push('      setTimeout(function () {');
      newLines.push('        import(\'./pages/\' + name + \'.js\').then(resolve).catch(function (e2) {');
      newLines.push('          console.error(\'[JS] 模块重试也失败: \' + name + \' - \' + (e2 && e2.message));');
      newLines.push('          reject(e2);');
      newLines.push('        });');
      newLines.push('      }, 1000);');
      newLines.push('    });');
      newLines.push('  });');
      newLines.push('}');
      skipUntilEndOfMod = true;
      continue;
    }
    if (skipUntilEndOfMod) {
      // Skip lines until we find the closing of _mod function
      if (line.trim().startsWith('// 预加载常用模块') || line.trim().startsWith('function _preloadMods')) {
        skipUntilEndOfMod = false;
        newLines.push(line);
      }
      continue;
    }
    newLines.push(line);
  }
  
  fs.writeFileSync(filePath, newLines.join('\n'), 'utf8');
  console.log('SUCCESS (line-based): import.meta.glob replaced');
}
