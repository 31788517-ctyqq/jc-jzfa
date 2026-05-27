/**
 * JczqYz 亚指临盘 + 关注热度数据获取
 *
 * 调用 m.100qiu.com/api/JczqYz（本地直连 127.0.0.1:8080）
 * 获取：
 *   - hotFocusNum  (关注热度人数)
 *   - hotWinRate / hotLoseRate (主客胜支持率)
 *   - lastPan + asiaLastAvgWinOdd + asiaLastAvgLoseOdd → oddsLive (亚指临盘)
 */
const http = require('http');

const LOCAL_HOST = '127.0.0.1';
const LOCAL_PORT = 8080;

// ── HTTP 请求 ──

function fetchJSON(path, timeoutMs) {
  timeoutMs = timeoutMs || 8000;
  return new Promise(function (resolve) {
    var opts = {
      hostname: LOCAL_HOST,
      port: LOCAL_PORT,
      path: path,
      method: 'GET',
      headers: { 'Host': 'm.100qiu.com', 'Accept': 'application/json' }
    };
    http.get(opts, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
        catch (e) { resolve(null); }
      });
    }).on('error', function () { resolve(null); })
      .setTimeout(timeoutMs, function () { resolve(null); });
  });
}

/**
 * 获取单场比赛的 JczqYz 数据
 * @param {string} dateStr  "2026-05-27"
 * @param {number} number   比赛编号（如 2）
 * @returns {{ hotFocusNum: number, hotWinRate: string, hotLoseRate: string, oddsLive: number, rq: number }|null}
 */
async function fetchJczqYz(dateStr, number) {
  var dt = dateStr.replace(/-/g, '');    // "20260527"
  var path = '/api/JczqYz?dateTime=' + dt + '&number=' + number;
  var resp = await fetchJSON(path);

  if (!resp || !resp.data) return null;

  var d = resp.data;

  // 关注热度人数
  var hotFocusNum = parseInt(d.hotFocusNum) || 0;

  // 亚指临盘：lastPan 是当前盘口值
  var oddsLive = parseFloat(d.lastPan) || 0;

  return {
    hotFocusNum:  hotFocusNum,
    hotWinRate:   d.hotWinRate   || '',
    hotLoseRate:  d.hotLoseRate  || '',
    oddsLive:     oddsLive,
    rq:           d.rq ? parseInt(d.rq) : 0
  };
}

module.exports = { fetchJczqYz: fetchJczqYz };
