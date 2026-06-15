// Local audit: check HTML URL references vs deploy paths
var fs = require('fs');
var html = fs.readFileSync('preview/index.html', 'utf8');

console.log('=== HTML references ===');
var jsRefs = html.match(/src="\/js\/[^"]+\.js"/g) || [];
var cssRefs = html.match(/href="\/css\/[^"]+\.css"/g) || [];
var allRefs = jsRefs.concat(cssRefs);

allRefs.forEach(function(r) { console.log('  ' + r.replace(/"/g,'')); });

console.log('\n=== DEPLOY_MAP (Nginx paths) ===');
// Check deploy.py for the nginx target paths
var dp = fs.readFileSync('deploy.py', 'utf8');
var mapLines = dp.match(/'.*preview\/.*',\s*'nginx'.*/g) || [];
mapLines.forEach(function(l) {
  var path = l.match(/'([^']+?)'/)[1];
  console.log('  preview/' + path.replace('preview/','') + ' -> NGINX_ROOT/' + path);
});

console.log('\n=== MISMATCH CHECK ===');
console.log('All JS/CSS in HTML use /js/ or /css/ prefix');
console.log('But deploy uploads to NGINX_ROOT + "preview/" prefix');
console.log('→ Nginx serves from ROOT, NOT preview/ subdir');
console.log('→ Need to copy preview/js/* to NGINX_ROOT/js/ etc.');
