import { api } from '../api.js';

export function loadHome() {
  var rankP = api('ranking-list', {}).catch(function () { return {}; });
  var matchP = api('match-list', {}).catch(function () { return []; });
  Promise.all([rankP, matchP]).then(function (r) {
    var rank = r[0], matches = r[1];
    var mcEl = document.getElementById('matchCount');
    if (mcEl) mcEl.textContent = matches.length || '-';
    var mrEl = document.getElementById('maxRankCount');
    if (mrEl) mrEl.textContent = rank.topExpertCount || 0;
  });
}
