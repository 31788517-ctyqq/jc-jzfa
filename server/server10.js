// Node 10 兼容版服务器
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
try { var database = require('./database'); } catch(e) { database = { initDatabase(){} } }
try { var {get} = require('./http-utils'); } catch(e) { get = null }
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors()); app.use(express.json());
app.use('/assets/worldcup', express.static(path.join(__dirname, '../miniprogram/images/worldcup')));
app.use(express.static(path.join(__dirname, '../preview')));

const CONFIG = { MIDOU_BASE: 'https://midou310.com/mdsj', MOBILE: process.env.MIDOU_MOBILE || '', PASSWORD: process.env.MIDOU_PASSWORD || '' };
const cache = { token: null, tokenExpire: 0, matches: null, matchTime: 0, recommCache: {} };

async function login() {
  const now = Date.now();
  if (cache.token && cache.tokenExpire > now) return cache.token;
  const res = await get(`${CONFIG.MIDOU_BASE}/gduser/login.do`, { mobile: CONFIG.MOBILE, password: CONFIG.PASSWORD });
  if (res.code === 1) { cache.token = res.data.token; cache.tokenExpire = now + 3600000; return cache.token; }
  throw new Error('Login failed');
}

async function fetchMatches() {
  const token = await login(); const timestamp = Date.now();
  const res = await get(`${CONFIG.MIDOU_BASE}/score/footballDataList.do`, { time: timestamp, order: 'status desc, start_datetime asc, data_id asc' }, { Cookie: `token=${token}` });
  if (res.code !== 1) throw new Error('fetch failed');
  return (res.data || []).map(m => ({ matchId: String(m.matchId), num: m.num || '', homeName: m.homeName || '', visitName: m.visitName || '', leagueName: m.leagueName || '', startTime: m.startTime || '', matchStatus: m.matchStatus, date: (m.startTime || '').slice(0, 10) }));
}

async function getRecommends(matchId) {
  const token = await login();
  const res = await get(`${CONFIG.MIDOU_BASE}/score/getExpertRecommData.do`, { dataId: matchId, type: 0 }, { Cookie: `token=${token}` });
  if (res.code !== 1) throw new Error('fetch failed');
  return (res.data || []).filter(i => i && i.type && i.num > 0).map(i => ({ type: i.type, num: i.num, result: i.result !== undefined ? i.result : null }));
}

async function ensureData() {
  const now = Date.now();
  if (!cache.matches || now - cache.matchTime > 60000) { cache.matches = await fetchMatches(); cache.matchTime = now; }
  return cache.matches;
}

async function ensureRecommends(matchId) {
  if (!cache.recommCache[matchId]) cache.recommCache[matchId] = await getRecommends(matchId);
  return cache.recommCache[matchId];
}

// 健康检查
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// API
app.post('/api', async (req, res) => {
  const { action, data = {} } = req.body;
  console.log(`[API] ${action}`);
  try {
    switch (action) {
      case 'match-list': {
        let matches = [];
        try { matches = await ensureData(); } catch(e) {}
        return res.json({ code: 1, data: matches });
      }
      case 'match-detail': {
        const { matchId } = data;
        let recommends = [];
        try { recommends = await ensureRecommends(matchId); } catch(e) {}
        return res.json({ code: 1, data: { match: {}, recommends } });
      }
      default:
        return res.json({ code: 0, msg: 'Not implemented' });
    }
  } catch(e) {
    return res.json({ code: 0, msg: e.message });
  }
});

database.initDatabase();
app.listen(PORT, () => console.log(`Server on port ${PORT}`));
