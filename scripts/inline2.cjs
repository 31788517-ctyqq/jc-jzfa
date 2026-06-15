var fs = require('fs');
var html = fs.readFileSync('preview/index.html', 'utf8');

// Find and fix navMyBtn
var old = 'id="navMyBtn" type="button" onclick="switchTab(\'profile\')" style="display:none">';
var n = 'id="navMyBtn" type="button" onclick="switchTab(\'profile\')" style="display:none;background:#7aaa96;color:#fff">';
html = html.replace(old, n);

fs.writeFileSync('preview/index.html', html, 'utf8');
fs.writeFileSync('index.html', html, 'utf8');
console.log('nav-mb inline:', html.includes('background:#7aaa96'));
console.log('home-mb inline:', html.includes('home-my-btn" style='));
