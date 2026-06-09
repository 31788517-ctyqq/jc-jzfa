const fs = require('fs');
const d = require('../server/expert_discovery.json');

const ranked = d.experts.filter((e) => e.hot_rank < 9999).sort((a, b) => a.hot_rank - b.hot_rank);
const unranked = d.experts.filter((e) => e.hot_rank >= 9999).sort((a, b) => (b.hit_rate || 0) - (a.hit_rate || 0));
const selected = [...ranked, ...unranked].slice(0, 200);

console.log('有人气排名:', ranked.map((e) => e.nickname + ' #' + e.hot_rank).join(', '));
console.log(
  '无排名前10:',
  unranked
    .slice(0, 10)
    .map((e) => e.nickname + ' rate:' + e.hit_rate + '% streak:' + e.streak)
    .join(', '),
);
console.log('入选:', selected.length, '位专家');

fs.writeFileSync(
  __dirname + '/../server/expert_discovery.json',
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      total_found: d.experts.length,
      selected_count: selected.length,
      experts: selected,
    },
    null,
    2,
  ),
);
console.log('已更新 expert_discovery.json');
