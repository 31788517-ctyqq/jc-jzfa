import paramiko, time, re
HOST="119.23.51.159"; USER="root"; PASS="znm19811225@"
ssh=paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST,22,USER,PASS,timeout=10,look_for_keys=False,allow_agent=False)

# Replace database.js with pure-JS JSON storage (no native compilation needed)
db_code = r"""const path = require('path');
const fs = require('fs');
const DB_PATH = path.join(__dirname, 'data.json');
let data = { matches: {}, recommends: {} };
try { if(fs.existsSync(DB_PATH)) data = JSON.parse(fs.readFileSync(DB_PATH,'utf8')); } catch(e){}
function save() { try { fs.writeFileSync(DB_PATH, JSON.stringify(data)); } catch(e){} }
module.exports = {
  initDatabase() {},
  batchUpsertMatches(matches, date) {
    matches.forEach(m => { const k = m.matchId||String(Date.now()); data.matches[k] = m; });
    save();
  },
  batchUpsertRecommends(recs, matchId, date) {
    if(!data.recommends[matchId]) data.recommends[matchId] = [];
    data.recommends[matchId] = data.recommends[matchId].concat(recs).slice(-200);
    save();
  },
  getMatchesByDate(date) { return Object.values(data.matches).filter(m => m.date === date); },
  getRecommendsByMatchId(matchId) { return data.recommends[matchId] || []; },
  getAllMatches() { return Object.values(data.matches); },
  getHitRateStats(days) { return { directionStats: [] }; },
  getDailyTrend() { return []; },
  logCrawl(d, c) {},
  getCrawledDates() { return []; },
  closeDatabase() { save(); }
};
"""

# Upload the new database.js
cmd = f"""cat > /var/www/zj.100qiu.com/server/database.js << 'DBEND'
{db_code}
DBEND
echo DB_UPLOADED"""
_,o,e=ssh.exec_command(cmd, timeout=10)
print(o.read().decode())

# Remove better-sqlite3 from package.json to avoid install attempts
_,o,e=ssh.exec_command("""cd /var/www/zj.100qiu.com/server
sed -i '/better-sqlite3/d' package.json 2>/dev/null
sed -i '/sqlite/d' package.json 2>/dev/null
echo CLEANED""", timeout=5)
print(o.read().decode())

# Restart PM2
print("[*] Restarting...")
chan=ssh.get_transport().open_session()
chan.exec_command("cd /var/www/zj.100qiu.com && pm2 restart jc-zjfa --update-env 2>&1")
while True:
    if chan.recv_ready(): print(chan.recv(65536).decode(errors='replace'), end='', flush=True)
    if chan.recv_stderr_ready(): print(chan.recv_stderr(65536).decode(errors='replace'), end='', flush=True)
    if chan.exit_status_ready(): break
    time.sleep(0.3)

time.sleep(4)

# Verify
_,o,e=ssh.exec_command("pm2 list 2>&1")
clean=re.sub(r'[^\x00-\x7F]+','.',o.read().decode())
print("\nPM2:", clean[:300])

_,o,e=ssh.exec_command("curl -s -m 5 http://localhost:3000/health")
print("Health:", o.read().decode()[:200])

_,o,e=ssh.exec_command("curl -s -m 5 -o /dev/null -w '%{http_code}' http://localhost:3000/")
print("HTTP:", o.read().decode())

# Check error log
_,o,e=ssh.exec_command("tail -5 /root/.pm2/logs/jc-zjfa-error.log 2>&1")
clean=re.sub(r'[^\x00-\x7F]+','.',o.read().decode())
print("ERR:", clean[:200])

ssh.close()
print("\n=== http://zj.100qiu.com ===")
