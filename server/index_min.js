// 竞彩推荐监控 - Node 10 兼容版
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use('/assets/worldcup', express.static(path.join(__dirname, '../miniprogram/images/worldcup')));
app.use(express.static(path.join(__dirname, '../preview')));

// 简易日志
const log = (s) => console.log(`[${new Date().toISOString().slice(0,19)}] ${s}`);

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), time: new Date().toISOString() });
});

// API
app.post('/api', (req, res) => {
  const { action, data = {} } = req.body;
  log(`API: ${action}`);
  
  try {
    // 尝试加载数据
    let jsonData = { matches: {}, recommends: {} };
    try {
      jsonData = require('./data.json');
    } catch(e) {
      log('data.json not loaded, using empty');
    }
    
    switch (action) {
      case 'match-list': {
        const matches = Object.values(jsonData.matches || {});
        // 也尝试实时抓取
        try {
          const http = require('./http-utils');
          const token = require('./login-helpers').login();
          // ... 实时抓取逻辑
        } catch(e) {}
        return res.json({ code: 1, data: matches });
      }
      case 'match-detail': {
        const { matchId } = data;
        const match = (jsonData.matches || {})[matchId];
        const recommends = (jsonData.recommends || {})[matchId] || [];
        return res.json({ code: 1, data: { match: match || {}, recommends } });
      }
      case 'ranking-list':
      case 'hit-rate-stats':
        return res.json({ code: 1, data: { categories: {}, ranking: [], directionStats: [] } });
      default:
        return res.json({ code: 0, msg: `Unknown: ${action}` });
    }
  } catch (e) {
    log(`Error: ${e.message}`);
    return res.json({ code: 0, msg: e.message });
  }
});

app.listen(PORT, () => {
  log(`Server running on port ${PORT}`);
  log(`Health: http://localhost:${PORT}/health`);
});
