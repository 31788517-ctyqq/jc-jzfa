// postbuild: 将构建产物 dist/index.html 同步到源目录
// 确保服务器回退场景下也能加载正确的构建入口
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'preview', 'dist', 'index.html');
const dst = path.join(__dirname, '..', 'preview', 'index.html');

if (fs.existsSync(src)) {
  fs.copyFileSync(src, dst);
  console.log('[postbuild] preview/index.html synced from dist/');
} else {
  console.warn('[postbuild] dist/index.html not found, skipping sync');
}
