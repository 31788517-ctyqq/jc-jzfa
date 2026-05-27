import { api } from '../api.js';

/** 当前PK的双方 */
var pkA = null;
var pkB = null;
var pkPending = null; // 等待选第二场

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getWDLDots(w, d, l) {
  w = w || 0; d = d || 0; l = l || 0;
  var dots = '';
  for (var i = 0; i < w; i++) dots += '<span class="pk-wdl-dot w">W</span>';
  for (var i = 0; i < d; i++) dots += '<span class="pk-wdl-dot d">D</span>';
  for (var i = 0; i < l; i++) dots += '<span class="pk-wdl-dot l">L</span>';
  return dots;
}

function renderPKModal() {
  var modal = document.getElementById('pkModal');
  if (!modal) return;

  if (!pkA || !pkB) {
    modal.innerHTML = '<div class="pk-header"><span class="pk-title">场次数据PK</span><span class="pk-close" onclick="closePK()">✕</span></div>' +
      '<div style="padding:40px 20px;text-align:center;color:var(--text2)">请选择两场比赛进行PK对比</div>';
    return;
  }

  var gsA = pkA.gs || {};
  var gsB = pkB.gs || {};

  modal.innerHTML =
    '<div class="pk-header">' +
      '<span class="pk-title">⚔️ 场次数据PK</span>' +
      '<span class="pk-close" onclick="closePK()">✕</span>' +
    '</div>' +
    // VS zone
    '<div class="pk-vs-zone">' +
      '<div class="pk-team-box"><div class="pk-team-home">' + esc(pkA.homeName) + '</div></div>' +
      '<div class="pk-vs">VS</div>' +
      '<div class="pk-team-box"><div class="pk-team-away">' + esc(pkB.homeName) + '</div></div>' +
    '</div>' +
    // Scores comparison
    '<div class="pk-compare-grid">' +
      pkRow('综合优势', gsA.totalAdvantage || '-', gsB.totalAdvantage || '-', gsA.totalAdvantageValue, gsB.totalAdvantageValue) +
      pkRow('进攻权重', gsA.attackWeightHome || '50%', gsB.attackWeightHome || '50%', parseInt(gsA.attackWeightHome) || 50, parseInt(gsB.attackWeightHome) || 50) +
      pkRow('防守权重', gsA.defenseWeightHome || '50%', gsB.defenseWeightHome || '50%', parseInt(gsA.defenseWeightHome) || 50, parseInt(gsB.defenseWeightHome) || 50) +
      pkRow('进攻优势', gsA.attackAdvantage || '-', gsB.attackAdvantage || '-', gsA.attackAdvantageValue, gsB.attackAdvantageValue) +
      pkRow('防守优势', gsA.defenseAdvantage || '-', gsB.defenseAdvantage || '-', gsA.defenseAdvantageValue, gsB.defenseAdvantageValue) +
    '</div>' +
    // Match info
    '<div class="pk-compare-grid">' +
      '<div class="pk-compare-label">比赛信息</div>' +
      '<div class="pk-compare-val">' + esc(pkA.num) + '<br><span style="font-size:10px;color:var(--text3)">' + esc(pkA.leagueName) + '</span></div>' +
      '<div style="text-align:center;color:var(--text3);font-size:10px">信息</div>' +
      '<div class="pk-compare-val">' + esc(pkB.num) + '<br><span style="font-size:10px;color:var(--text3)">' + esc(pkB.leagueName) + '</span></div>' +
    '</div>';
}

function pkRow(label, valA, valB, numA, numB) {
  numA = typeof numA === 'number' ? numA : 50;
  numB = typeof numB === 'number' ? numB : 50;
  var maxVal = Math.max(numA, numB, 1);
  var wA = Math.round(numA / maxVal * 100);
  var wB = Math.round(numB / maxVal * 100);
  return '<div class="pk-compare-row">' +
    '<div class="pk-compare-bar-wrap">' +
      '<span style="font-size:10px;color:var(--text3);min-width:24px;text-align:right">' + valA + '</span>' +
      '<div class="pk-compare-bar-bg"><div class="pk-compare-bar-fill home" style="width:' + wA + '%"></div></div>' +
    '</div>' +
    '<div style="font-size:10px;color:var(--text3);text-align:center">' + label + '</div>' +
    '<div class="pk-compare-bar-wrap">' +
      '<div class="pk-compare-bar-bg"><div class="pk-compare-bar-fill away" style="width:' + wB + '%"></div></div>' +
      '<span style="font-size:10px;color:var(--text3);min-width:24px">' + valB + '</span>' +
    '</div>' +
  '</div>';
}

export function openPK(matchIdA, homeA, awayA, leagueA, numA) {
  var overlay = document.getElementById('pkOverlay');
  if (!overlay) return;
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';

  // 如果还没选第一场，保存第一场
  if (!pkPending) {
    pkA = {
      matchId: matchIdA,
      homeName: homeA,
      visitName: awayA,
      leagueName: leagueA,
      num: numA
    };
    // 预加载第一场的功守道数据
    api('gongshoudao', { matchId: matchIdA }).then(function (gs) {
      pkA.gs = gs || {};
      if (pkB) renderPKModal();
    }).catch(function () { pkA.gs = {}; if (pkB) renderPKModal(); });

    var modal = document.getElementById('pkModal');
    if (!modal) return;
    modal.innerHTML =
      '<div class="pk-header">' +
        '<span class="pk-title">⚔️ 场次数据PK</span>' +
        '<span class="pk-close" onclick="closePK()">✕</span>' +
      '</div>' +
      '<div style="padding:30px 20px;text-align:center">' +
        '<div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:4px">已选择第一场</div>' +
        '<div style="font-size:16px;font-weight:700;color:var(--cyan);margin-bottom:8px">' + esc(homeA) + ' vs ' + esc(awayA) + '</div>' +
        '<div style="font-size:11px;color:var(--text3);margin-bottom:20px">' + esc(numA) + ' · ' + esc(leagueA) + '</div>' +
        '<div style="font-size:13px;color:var(--text2);margin-bottom:12px">请返回排行榜选择第二场比赛</div>' +
        '<button style="padding:10px 24px;border-radius:20px;background:rgba(24,224,224,0.1);border:1px solid rgba(24,224,224,0.2);color:var(--cyan);font-size:13px;cursor:pointer" onclick="closePK()">关闭</button>' +
      '</div>';
    return;
  }

  // 选了第二场
  pkB = {
    matchId: matchIdA,
    homeName: homeA,
    visitName: awayA,
    leagueName: leagueA,
    num: numA
  };

  // 加载第二场功守道数据
  api('gongshoudao', { matchId: matchIdA }).then(function (gs) {
    pkB.gs = gs || {};
    renderPKModal();
  }).catch(function () { pkB.gs = {}; renderPKModal(); });

  var modal = document.getElementById('pkModal');
  if (modal) modal.innerHTML =
    '<div style="text-align:center;padding:80px 20px;color:var(--cyan)">' +
    '<div style="font-size:40px;margin-bottom:16px">⚔️</div>' +
    '<div style="font-size:14px;font-weight:600">PK 加载中...</div>' +
    '</div>';
}

export function closePK() {
  var overlay = document.getElementById('pkOverlay');
  if (overlay) overlay.classList.remove('active');
  document.body.style.overflow = '';
  pkA = null;
  pkB = null;
  pkPending = null;
}
