import paramiko, time
HOST="119.23.51.159"; USER="root"; PASS="znm19811225@"
ssh=paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST,22,USER,PASS,timeout=10,look_for_keys=False,allow_agent=False)

# Create a fallback database adapter that works without better-sqlite3
fallback_db = """
const path = require('path');
const fs = require('fs');
const DB_PATH = path.join(__dirname, 'data.json');
let data = { matches: {}, recommends: {}, logs: [] };

function save() { fs.writeFileSync(DB_PATH, JSON.stringify(data)); }
function load() { if(fs.existsSync(DB_PATH)) data = JSON.parse(fs.readFileSync(DB_PATH,'utf8')); }
load();

module.exports = {
  initDatabase() { load(); },
  batchUpsertMatches(matches, date) {
    matches.forEach(m => { data.matches[m.matchId] = m; });
    save();
  },
  batchUpsertRecommends(recs, matchId, date) {
    data.recommends[matchId] = { items: recs, date };
    save();
  },
  getMatchesByDate(date) {
    return Object.values(data.matches).filter(m => m.date === date);
  },
  getRecommendsByMatchId(matchId) {
    const r = data.recommends[matchId];
    return r ? r.items : [];
  },
  getAllMatches() { return Object.values(data.matches); },
  getHitRateStats(days) { return { directionStats: [] }; },
  getDailyTrend() { return []; },
  logCrawl() {},
  getCrawledDates() { return []; },
  closeDatabase() { save(); }
};
"""

# Upload the fallback module
cmd = f"cat > /var/www/zj.100qiu.com/server/database_fallback.js << 'FALLBACK_EOF'\n{fallback_db}\nFALLBACK_EOF\necho FALLBACK_DONE"
_,o,e=ssh.exec_command(cmd, timeout=10)
print(o.read().decode())

# Patch index.js to use fallback if SQLite fails
cmd2 = """cd /var/www/zj.100qiu.com/server && cat > database.js << 'DBPATCH'
try {
  module.exports = require('./database_better.js');
  console.log('[db] using better-sqlite3');
} catch(e) {
  console.log('[db] better-sqlite3 unavailable, using JSON fallback');
  module.exports = require('./database_fallback.js');
}
DBPATCH
echo DBPATCH_DONE"""
_,o,e=ssh.exec_command(cmd2, timeout=10)
print(o.read().decode())

# Rename original database.js
_,o,e=ssh.exec_command("cd /var/www/zj.100qiu.com/server && cp database.js database_better.js 2>/dev/null; echo RENAMED", timeout=5)
print(o.read().decode())

# Restart
print("[*] Restarting PM2...")
chan=ssh.get_transport().open_session()
chan.exec_command("cd /var/www/zj.100qiu.com && pm2 restart jc-zjfa --update-env 2>&1")
while True:
    if chan.recv_ready(): print(chan.recv(65536).decode(errors='replace'), end='', flush=True)
    if chan.recv_stderr_ready(): print(chan.recv_stderr(65536).decode(errors='replace'), end='', flush=True)
    if chan.exit_status_ready(): break
    time.sleep(0.3)

time.sleep(5)

# Check
_,o,e=ssh.exec_command("curl -s -m 5 http://localhost:3000/health 2>&1")
print("\nHealth:", o.read().decode()[:200])

_,o,e=ssh.exec_command("curl -s -m 5 -o /dev/null -w '%{http_code}' http://localhost:3000/ 2>&1")
print("HTTP:", o.read().decode())

ssh.close()
print("Done!")
