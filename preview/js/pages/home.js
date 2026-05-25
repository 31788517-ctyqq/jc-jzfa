import { api } from '../api.js';

export function loadHome() {
  var rankP = api('ranking-list', {}).catch(function () { return {}; });
  var matchP = api('match-list', {}).catch(function () { return []; });
  Promise.all([rankP, matchP]).then(function (r) {
    var rank = r[0], matches = r[1];
    var mcEl = document.getElementById('matchCount');
    if (mcEl) mcEl.textContent = matches.length || '-';
    var mrEl = document.getElementById('maxRankCount');
    // 统计所有比赛的推荐专家数合计（而非单场最高）
    if (mrEl) mrEl.textContent = matches.reduce(function(s, m) { return s + (m.recommNum || 0); }, 0) || '-';
  });
}
