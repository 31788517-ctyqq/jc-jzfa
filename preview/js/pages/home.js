import { api } from '../api.js';
import { formatDate } from '../utils.js';

export function loadHome() {
  var todayStr = formatDate(new Date());
  var rankP = api('ranking-list', { date: todayStr }).catch(function () { return {}; });
  var matchP = api('match-list', { date: todayStr }).catch(function () { return []; });
  Promise.all([rankP, matchP]).then(function (r) {
    var rank = r[0], matches = r[1];
    var mcEl = document.getElementById('matchCount');
    if (mcEl) mcEl.textContent = matches.length || '-';
    var mrEl = document.getElementById('maxRankCount');
    if (mrEl) mrEl.textContent = rank.topExpertCount || 0;
  });
}
