var fs = require('fs'), cp = require('child_process');
var c = fs.readFileSync('preview/js/main-fusion.js', 'utf8');

var start = c.indexOf('const _pageModules = import.meta.glob');
if (start < 0) { console.log('no import.meta'); process.exit(0); }

var end = c.indexOf('// 预加载常用模块', start);
if (end < 0) { console.log('no end marker'); process.exit(1); }

var repl = "function _mod(name) { return import('./pages/' + name + '.js').catch(function (e) { console.error('[JS] load fail: ' + name + ' - ' + (e && e.message)); return new Promise(function (resolve, reject) { setTimeout(function () { import('./pages/' + name + '.js').then(resolve).catch(function (e2) { console.error('[JS] retry fail: ' + name + ' - ' + (e2 && e2.message)); reject(e2); }); }, 1000); }); }); }\n\n";

c = c.substring(0, start) + repl + c.substring(end);
console.log('import.meta:', c.includes('import.meta'));
console.log('_mod:', c.includes('function _mod('));

fs.writeFileSync('preview/js/main-fusion.js', c, 'utf8');

var r = cp.spawnSync('node', ['-c', 'preview/js/main-fusion.js'], {encoding: 'utf8'});
console.log(r.stderr ? 'SYNTAX FAIL' : 'SYNTAX OK');
