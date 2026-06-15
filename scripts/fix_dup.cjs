// Remove duplicate _prefetchTabData definition
var fs = require('fs');
var c = fs.readFileSync('preview/js/main-fusion.js', 'utf8');

// Find the second occurrence (the duplicate)
var pat1 = 'function _prefetchTabData(tab) {';
var first = c.indexOf(pat1);
var second = c.indexOf(pat1, first + 1);

if (second < 0) {
  console.log('No duplicate found');
  process.exit(0);
}

// Find the full function block from second occurrence
// Find the matching closing brace
var start = c.lastIndexOf('\n', second) + 1; // beginning of line
// Find end: the next function/export declaration or end of file
// Look for the next significant function declaration after this one
var after = c.substring(second + 50);
var nextFnIdx = after.search(/^\s*(?:function |export function |\/\/ )/m);
var end = second + 50 + (nextFnIdx > 0 ? nextFnIdx : after.length);

// Also check for preceding comment
var commentStart = c.lastIndexOf('// ', start);
if (commentStart > 0 && (start - commentStart) < 200) {
  // Include the comment
  var seg = c.substring(commentStart, end);
  console.log('Removing duplicate at position', commentStart, 'to', end);
  console.log('Content:', seg.substring(0, 100).replace(/\r?\n/g, '\\n') + '...');
  c = c.substring(0, commentStart) + c.substring(end);
} else {
  var seg = c.substring(start, end);
  console.log('Removing duplicate at position', start, 'to', end);
  console.log('Content:', seg.substring(0, 100).replace(/\r?\n/g, '\\n') + '...');
  c = c.substring(0, start) + c.substring(end);
}

// Verify
var cnt = c.split(pat1).length - 1;
console.log('_prefetchTabData occurrences:', cnt);

fs.writeFileSync('preview/js/main-fusion.js', c, 'utf8');

// Syntax check
var cp = require('child_process');
var r = cp.spawnSync('node', ['-c', 'preview/js/main-fusion.js'], {encoding: 'utf8'});
if (r.stderr) {
  console.log('SYNTAX ERROR:', r.stderr.substring(0, 200));
} else {
  console.log('SYNTAX OK');
}
