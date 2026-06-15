var fs = require('fs');
var c = fs.readFileSync('preview/css/app.css', 'utf8');

// Count home-my-btn references
var cnt = (c.match(/home-my-btn/g) || []).length;
console.log('home-my-btn mentions:', cnt);

var idx = c.indexOf('home-my-btn');
while (idx >= 0) {
  console.log('  at', idx, ':', c.substring(idx, idx + 70).replace(/\r?\n/g, ' '));
  idx = c.indexOf('home-my-btn', idx + 1);
}

// Check for override rules after the green definition
var greenIdx = c.indexOf('.nav-my-btn');
var after = c.substring(greenIdx + 200, greenIdx + 500);
console.log('\nAfter green definition:', after.replace(/\r?\n/g, '\\n'));
