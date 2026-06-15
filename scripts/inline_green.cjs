var fs = require('fs');
var html = fs.readFileSync('preview/index.html', 'utf8');

// Add inline green style to home-my-btn
html = html.replace(
  'class="home-my-btn" type="button" onclick="switchTab(\'profile\')" aria-label="\u6211\u7684\u8d26\u53f7">',
  'class="home-my-btn" type="button" onclick="switchTab(\'profile\')" aria-label="\u6211\u7684\u8d26\u53f7" style="background:#7aaa96;color:#fff">'
);

// Add inline green style to navMyBtn
html = html.replace(
  'class="nav-my-btn" id="navMyBtn" type="button" onclick="switchTab(\'profile\')" aria-label="\u6211\u7684\u8d26\u53f7" style="display:none">',
  'class="nav-my-btn" id="navMyBtn" type="button" onclick="switchTab(\'profile\')" aria-label="\u6211\u7684\u8d26\u53f7" style="display:none;background:#7aaa96;color:#fff">'
);

fs.writeFileSync('preview/index.html', html, 'utf8');
fs.writeFileSync('index.html', html, 'utf8');

console.log('home-mb inline:', html.includes('home-my-btn" style='));
console.log('nav-mb inline:', html.includes('nav-my-btn" style='));
