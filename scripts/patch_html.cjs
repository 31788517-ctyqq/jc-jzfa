// Read from clean Phase1 HTML, add features
var fs = require('fs');
var path = require('path');

var html = fs.readFileSync('preview/index_clean.html', 'utf8');
console.log('Input size:', html.length);
console.log('Is Unicode:', html.charCodeAt(0) === 0xFEFF);

// Remove BOM if present
if (html.charCodeAt(0) === 0xFEFF) {
  html = html.slice(1);
}

// Check key patterns
console.log('Has dns-prefetch:', html.includes('dns-prefetch'));
console.log('Has nav-back:', html.includes('nav-back'));
console.log('Has main-fusion.js:', html.includes('main-fusion.js'));
console.log('Has admin-v2:', html.includes('admin-v2'));
console.log('Has /css/app.css:', html.includes('/css/app.css'));

// 2. Add vendor.js modulepreload
// Try various patterns
var patterns = [
  '<link rel="dns-prefetch" href="https://midou310.com" />',
  '<link rel="dns-prefetch" href="https://midou310.com"/>',
  'dns-prefetch',
];
for (var i = 0; i < patterns.length; i++) {
  if (html.includes(patterns[i])) {
    console.log('Found pattern:', i);
    break;
  }
}

// Let me print some context
var idx = html.indexOf('dns-prefetch');
if (idx >= 0) {
  console.log('dns-prefetch context:', html.substring(idx - 20, idx + 80).replace(/\r?\n/g, '\\n'));
}
