var fs = require('fs');
var mf = fs.readFileSync('preview/js/main-fusion.js', 'utf8');
console.log('import.meta:', mf.includes('import.meta'));
console.log('_prefetchTabData:', (mf.match(/function _prefetchTabData/g) || []).length);
console.log('navMyBtn:', mf.includes('navMyBtn'));
console.log('_stReal:', mf.includes('_stReal'));
console.log('switchTab:', (mf.match(/function switchTab\b/g) || []).length);
