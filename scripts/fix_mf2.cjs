// Fix main-fusion.js: remove BOM + version stamps + import.meta.glob
var fs = require('fs');
var c = fs.readFileSync('preview/js/main-fusion.js', 'utf8');

// 1. Remove BOM
c = c.replace(/^\uFEFF/, '');

// 2. Remove version stamps
c = c.replace(/\?v=\d{10,12}/g, '');

// 3. Find and replace the import.meta.glob block with simple dynamic import
// Find "const _pageModules = import.meta.glob..." through the end of _mod function
var startIdx = c.indexOf('const _pageModules = import.meta.glob');
if (startIdx >= 0) {
  // Find the closing brace of _mod function
  // Look for the pattern: ... }); }); });} ... (the triple closing of nested catch/promises)
  // Simpler: find "// 预加载常用模块" which comes right after _mod
  var endMarker = '// 预加载常用模块';
  var endIdx = c.indexOf(endMarker, startIdx);
  
  if (endIdx >= 0) {
    var replacement = 'function _mod(name) {\n  return import(\'./pages/\' + name + \'.js\').catch(function (e) {\n    console.error(\'[JS] 模块加载失败: \' + name + \' - \' + (e && e.message));\n    return new Promise(function (resolve, reject) {\n      setTimeout(function () {\n        import(\'./pages/\' + name + \'.js\').then(resolve).catch(function (e2) {\n          console.error(\'[JS] 模块重试也失败: \' + name + \' - \' + (e2 && e2.message));\n          reject(e2);\n        });\n      }, 1000);\n    });\n  });\n}\n\n';
    c = c.substring(0, startIdx) + replacement + c.substring(endIdx);
    console.log('Replaced from index', startIdx, 'to', endIdx);
  } else {
    console.log('End marker not found');
  }
}

console.log('has import.meta:', c.includes('import.meta'));
console.log('size:', c.length);

fs.writeFileSync('preview/js/main-fusion.js', c, 'utf8');
