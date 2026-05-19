/**
 * 实时比分同步脚本
 * 从 midou310.com 抓取比赛状态和比分，输出 live_scores.json
 * Node 10 兼容
 */
var https = require('https');
var fs = require('fs');
var path = require('path');

var CONFIG = {
  MIDOU_BASE: 'https://midou310.com/mdsj',
  MOBILE: process.env.MIDOU_MOBILE || '',
  PASSWORD: process.env.MIDOU_PASSWORD || ''
};

var OUTPUT = path.join(__dirname, 'live_scores.json');
var LOG_FILE = path.join(__dirname, '..', 'logs', 'score_sync.log');

function log(msg) {
  var line = '[' + new Date().toISOString() + '] ' + msg;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch(e) {}
}

function get(urlStr, params, headers) {
  return new Promise(function(resolve, reject) {
    var qs = '';
    if (params) {
      qs = '?' + Object.keys(params).map(function(k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
      }).join('&');
    }
    var fullUrl = urlStr + qs;
    var urlObj = require('url').parse(fullUrl);

    var options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.path,
      method: 'GET',
      headers: Object.assign({
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0'
      }, headers || {}),
      rejectUnauthorized: false
    };

    var req = https.request(options, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        var buffer = Buffer.concat(chunks);
        var text = buffer.toString('utf-8');
        // Try GBK if UTF-8 fails
        try { JSON.parse(text); } catch(e) {
          try { text = require('iconv-lite').decode(buffer, 'gbk'); } catch(e2) {}
        }
        try { resolve(JSON.parse(text)); } catch(e) {
          reject(new Error('JSON parse fail: ' + text.slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, function() { req.abort(); reject(new Error('Timeout')); });
    req.end();
  });
}

async function sync() {
  try {
    // 1. Login
    log('开始同步比分...');
    var loginRes = await get(CONFIG.MIDOU_BASE + '/gduser/login.do', {
      mobile: CONFIG.MOBILE, password: CONFIG.PASSWORD
    });
    if (loginRes.code !== 1) throw new Error('登录失败: ' + (loginRes.msg || 'unknown'));
    var token = loginRes.data.token;
    var today = (loginRes.data.today || new Date().toISOString()).slice(0, 10);

    // 2. Fetch matches
    var matchRes = await get(CONFIG.MIDOU_BASE + '/score/footballDataList.do', {
      time: Date.now(),
      order: 'status desc, start_datetime asc, data_id asc'
    }, { Cookie: 'token=' + token });

    if (matchRes.code !== 1) throw new Error('获取比赛失败: ' + (matchRes.msg || ''));
    var matches = (matchRes.data || []).map(function(m) {
      return {
        matchId: String(m.matchId || m.dataId || ''),
        num: m.num || '',
        homeName: m.homeName || '',
        visitName: m.visitName || '',
        leagueName: m.leagueName || '',
        startTime: m.startTime || m.start_datetime || '',
        matchStatus: m.matchStatus !== undefined ? m.matchStatus : 0,
        score: m.score || '',
        homeScore: m.homeScore !== undefined ? m.homeScore : -1,
        visitScore: m.visitScore !== undefined ? m.visitScore : -1,
        recommNum: m.recommNum || 0,
        date: today
      };
    });

    // 3. Write output
    var output = { date: today, matches: matches, updated: new Date().toISOString() };
    fs.writeFileSync(OUTPUT, JSON.stringify(output));

    var liveCount = matches.filter(function(m) { return m.matchStatus === 1; }).length;
    var finishedCount = matches.filter(function(m) { return m.matchStatus === 2; }).length;
    log('同步完成: ' + matches.length + '场, 进行中:' + liveCount + ', 已结束:' + finishedCount);
  } catch(e) {
    log('同步失败: ' + e.message);
    process.exit(1);
  }
}

// Load .env if available
try {
  var envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf-8');
  envFile.split('\n').forEach(function(line) {
    var parts = line.trim().split('=');
    if (parts.length === 2 && parts[0] && !parts[0].startsWith('#')) {
      process.env[parts[0]] = parts[1];
    }
  });
  CONFIG.MOBILE = process.env.MIDOU_MOBILE || CONFIG.MOBILE;
  CONFIG.PASSWORD = process.env.MIDOU_PASSWORD || CONFIG.PASSWORD;
} catch(e) {}

if (!CONFIG.MOBILE || !CONFIG.PASSWORD) {
  log('缺少 MIDOU_MOBILE/MIDOU_PASSWORD 环境变量');
  process.exit(1);
}

sync();
