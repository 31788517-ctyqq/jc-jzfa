// Clean index.html: remove inline module, verify main-fusion reference
var fs = require('fs');
var content = fs.readFileSync('preview/index.html', 'utf8');

// Remove inline type="module" scripts
content = content.replace(/<script type="module">[\s\S]*?<\/script>/g, '');

// Clean version stamps
content = content.replace(/\?v=\d{10,12}/g, '');

// Check state
var hasMainFusion = content.indexOf('main-fusion.js') >= 0;
var hasInline = content.indexOf('INLINE-MODULE') >= 0;
console.log('main-fusion:', hasMainFusion, 'inline-module:', hasInline);

// Check for module script
var moduleScripts = content.match(/<script[^>]*type="module"[^>]*>/g);
console.log('module scripts:', moduleScripts);

fs.writeFileSync('preview/index.html', content, 'utf8');
