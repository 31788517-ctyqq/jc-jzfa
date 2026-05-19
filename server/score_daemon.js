/**
 * 比分同步守护进程（每2分钟执行一次）
 */
var exec = require('child_process').exec;
var path = require('path');

function run() {
  var script = path.join(__dirname, 'sync_scores.js');
  exec('node ' + script, { timeout: 30000 }, function(err, stdout, stderr) {
    if (err) console.error('sync err:', err.message);
    if (stdout) console.log(stdout.trim());
    if (stderr) console.error(stderr.trim());
  });
}

console.log('[score_daemon] 启动，每2分钟同步一次');
run();
setInterval(run, 120000);
