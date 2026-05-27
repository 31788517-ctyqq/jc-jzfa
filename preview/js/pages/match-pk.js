import { api } from '../api.js';

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 打开多场PK弹窗 */
export function openPKMulti(pickedList) {
  var overlay = document.getElementById('pkOverlay');
  if (!overlay || pickedList.length < 2) return;
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';

  var modal = document.getElementById('pkModal');
  if (!modal) return;
  modal.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--cyan)">⚔️ PK数据加载中...</div>';

  renderMultiPK(modal, pickedList);
}

function renderMultiPK(modal, list) {
  var vsList = [];
  // 两两配对: list[i] vs list[i+1]
  for (var i = 0; i < list.length - 1; i++) {
    vsList.push({ a: list[i], b: list[i + 1] });
  }
  // 如果大于2场，最后一场vs第一场
  if (list.length > 2 && vsList.length > 0) {
    vsList.push({ a: list[list.length - 1], b: list[0] });
  }

  var html =
    '<div class="pk-header">' +
      '<span class="pk-title">⚔️ 场次数据PK</span>' +
      '<span class="pk-close" onclick="closePK()">✕</span>' +
    '</div>' +
    '<div style="padding:12px 16px;font-size:11px;color:var(--text3)">已选 ' + list.length + ' 场 · 共 ' + vsList.length + ' 组对决</div>';

  vsList.forEach(function (vs, idx) {
    var a = vs.a, b = vs.b;
    html +=
      '<div style="margin:0 12px 12px;padding:12px;border-radius:12px;border:1px solid rgba(24,224,224,0.08);background:rgba(24,224,224,0.02)">' +
        '<div style="font-size:10px;color:var(--text3);margin-bottom:8px">对决 #' + (idx + 1) + '</div>' +
        '<div class="pk-vs-zone" style="padding:8px 0">' +
          '<div class="pk-team-box"><div class="pk-team-home" style="font-size:14px">' + esc(a.homeName) +
            '<div style="font-size:10px;color:var(--text3)">' + esc(a.num) + '</div></div></div>' +
          '<div class="pk-vs" style="font-size:18px">VS</div>' +
          '<div class="pk-team-box"><div class="pk-team-home" style="font-size:14px">' + esc(b.homeName) +
            '<div style="font-size:10px;color:var(--text3)">' + esc(b.num) + '</div></div></div>' +
        '</div>' +
        '<div class="pk-compare-grid">' +
          pkRow('综合实力', a.totalAdvantage || '-', b.totalAdvantage || '-', a.totalAdvantageValue, b.totalAdvantageValue) +
          pkRow('进攻优势', a.attackAdvantageValue + '', b.attackAdvantageValue + '', a.attackAdvantageValue || 50, b.attackAdvantageValue || 50) +
          pkRow('防守优势', a.defenseAdvantageValue + '', b.defenseAdvantageValue + '', a.defenseAdvantageValue || 50, b.defenseAdvantageValue || 50) +
          pkRow('净胜球', a.goalDiff || '-', b.goalDiff || '-', parseFloat(String(a.goalDiff).split('/')[0]) * 10 + 50 || 50, parseFloat(String(b.goalDiff).split('/')[0]) * 10 + 50 || 50) +
        '</div>' +
      '</div>';
  });

  modal.innerHTML = html;
}

function pkRow(label, valA, valB, numA, numB) {
  numA = typeof numA === 'number' ? Math.abs(numA) : 50;
  numB = typeof numB === 'number' ? Math.abs(numB) : 50;
  var maxVal = Math.max(numA, numB, 1);
  var wA = Math.round(numA / maxVal * 100);
  var wB = Math.round(numB / maxVal * 100);
  return '<div class="pk-compare-row">' +
    '<div class="pk-compare-bar-wrap">' +
      '<span style="font-size:9px;color:var(--text3);min-width:28px;text-align:right">' + valA + '</span>' +
      '<div class="pk-compare-bar-bg"><div class="pk-compare-bar-fill home" style="width:' + wA + '%"></div></div>' +
    '</div>' +
    '<div style="font-size:9px;color:var(--text3);text-align:center">' + label + '</div>' +
    '<div class="pk-compare-bar-wrap">' +
      '<div class="pk-compare-bar-bg"><div class="pk-compare-bar-fill away" style="width:' + wB + '%"></div></div>' +
      '<span style="font-size:9px;color:var(--text3);min-width:28px">' + valB + '</span>' +
    '</div>' +
  '</div>';
}

export function closePK() {
  var overlay = document.getElementById('pkOverlay');
  if (overlay) overlay.classList.remove('active');
  document.body.style.overflow = '';
}

// 兼容旧版 openPK（单场选择模式已废弃，用多选替代）
export function openPK() {}
