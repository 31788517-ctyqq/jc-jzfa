import { api } from '../api.js';

export const filterDirMap = {
  胜平负: ['全部', '胜', '平', '负'],
  让球: ['全部', '让胜', '让平', '让负'],
  进球数: [
    '全部',
    '总进球-1、2球',
    '总进球-2、3球',
    '总进球-3、4球',
    '总进球-1、2、3球',
    '总进球-2、3、4球',
    '总进球-3、4、5球',
  ],
  双选: ['全部', '平、让平', '让胜、让平', '让平、让负', '胜、平', '平、负'],
  半全场: ['全部', '半全场-胜胜', '半全场-负负'],
};

export function toggleDD(id, evt) {
  if (evt) {
    evt.stopPropagation();
    evt.preventDefault();
  }
  const dd = document.getElementById(id);
  if (!dd) return;
  const wasOpen = dd.classList.contains('open');
  closeAllDD();
  if (!wasOpen) {
    dd.classList.add('open');
    const menu = dd.querySelector('.filter-dd-menu');
    const trigger = dd.querySelector('.filter-dd-trigger');
    if (!menu || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const menuW = Math.max(rect.width, 156);
    const menuH = Math.min(menu.scrollHeight || 240, Math.max(180, vh - 36));
    const spaceBelow = vh - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const left = Math.max(10, Math.min(rect.left, vw - menuW - 10));

    // Portal 到 body，彻底脱离卡片/页面/动画产生的 stacking context 和 overflow 裁剪。
    const portal = menu.cloneNode(true);
    portal.classList.add('filter-dd-portal');
    portal.setAttribute('data-owner-dd', id);
    portal.style.display = 'block';
    portal.style.position = 'fixed';
    portal.style.zIndex = '2147483647';
    portal.style.left = left + 'px';
    portal.style.width = menuW + 'px';
    portal.style.right = 'auto';
    portal.style.maxHeight = menuH + 'px';
    portal.style.overflowY = 'auto';
    portal.style.WebkitOverflowScrolling = 'touch';
    portal.style.pointerEvents = 'auto';
    if (spaceBelow >= menuH || spaceBelow >= spaceAbove) {
      portal.style.top = rect.bottom + 8 + 'px';
      portal.style.bottom = 'auto';
    } else {
      portal.style.bottom = vh - rect.top + 8 + 'px';
      portal.style.top = 'auto';
    }
    menu.style.display = 'none';
    menu.setAttribute('data-portal-hidden', '1');
    document.body.appendChild(portal);
  }
}

export function selectDD(id, val, text) {
  const dd = document.getElementById(id);
  if (!dd) return;
  dd.setAttribute('data-val', val);
  const textEl = dd.querySelector('.filter-dd-text');
  if (textEl) textEl.textContent = text;
  dd.querySelectorAll('.filter-dd-option').forEach(function (o) {
    o.classList.toggle('selected', o.getAttribute('data-val') === val);
  });
  closeAllDD();
}

export function getDDVal(id) {
  const el = document.getElementById(id);
  return el ? el.getAttribute('data-val') || '' : '';
}

export function closeAllDD() {
  document.querySelectorAll('.filter-dd.open').forEach(function (d) {
    d.classList.remove('open');
  });
  document.querySelectorAll('.filter-dd-menu[data-portal-hidden="1"]').forEach(function (m) {
    m.style.display = '';
    m.removeAttribute('data-portal-hidden');
  });
  document.querySelectorAll('.filter-dd-portal').forEach(function (p) {
    p.remove();
  });
}

export function handleDocClose(e) {
  if (!e.target) return;
  const inDD = e.target.closest('.filter-dd');
  const inPortal = e.target.closest('.filter-dd-portal');
  if (!inDD && !inPortal) closeAllDD();
}

export function resetFilterResult() {
  const el = document.getElementById('filterResult');
  if (el) el.innerHTML = '<div class="hint-box">选择筛选条件后点击"查询"按钮</div>';
}

export function loadFilterLeagues() {
  return api('filter-stats', {})
    .then(function (stats) {
      const sm = document.getElementById('statMatches');
      const sl = document.getElementById('statLeagues');
      const sd = document.getElementById('statDirs');
      if (sm) sm.textContent = stats.matchCount || 0;
      if (sl) sl.textContent = stats.leagueCount || 0;
      if (sd) sd.textContent = stats.directionCount || 0;
      const ddLeague = document.getElementById('dd-league');
      if (ddLeague) {
        const menu = ddLeague.querySelector('.filter-dd-menu');
        let html =
          '<li data-val="" class="filter-dd-option selected" onclick="selectDD(\'dd-league\',\'\',\'全部\')">全部</li>';
        (stats.leagues || []).forEach(function (l) {
          html +=
            '<li data-val="' +
            l +
            '" class="filter-dd-option" onclick="selectDD(\'dd-league\',\'' +
            l +
            "','" +
            l +
            '\')">' +
            l +
            '</li>';
        });
        if (menu) menu.innerHTML = html;
      }
      // 待回填提示（仅统计全部推荐结果缺失的比赛，不包括部分缺失）
      const fr = document.getElementById('filterResult');
      let hintHtml = '';
      if (stats.staleCount > 0) {
        hintHtml +=
          '<div class="hint-box" style="color:var(--amber);font-size:12px;padding:20px 0;">' +
          '\u26A0 ' +
          stats.staleCount +
          ' 场比赛的全部推荐结果尚未确定，需要回填。';
        if (stats.totalMatches !== undefined) {
          hintHtml +=
            '<br><span style="color:var(--text3);">共 ' +
            stats.totalMatches +
            ' 场比赛，' +
            stats.matchCount +
            ' 场已有结果数据</span>';
        }
        if (stats.partialStaleCount > 0) {
          hintHtml +=
            '<br><span style="color:var(--cyan);">' + stats.partialStaleCount + ' 场比赛部分推荐结果缺失</span>';
        }
        hintHtml +=
          '<br><span style="color:var(--text3);">运行 <code>node backfill_results.js</code> 补全数据</span></div>';
      }
      if (fr && hintHtml) {
        fr.innerHTML = hintHtml;
      }
    })
    .catch(function () {
      const sm2 = document.getElementById('statMatches');
      const sl2 = document.getElementById('statLeagues');
      const sd2 = document.getElementById('statDirs');
      if (sm2) sm2.textContent = '-';
      if (sl2) sl2.textContent = '-';
      if (sd2) sd2.textContent = '-';
    });
}

export function onDDTypeChange() {
  const type = getDDVal('dd-dirType');
  const ddDir = document.getElementById('dd-dir');
  if (!type || type === '综合排名') {
    if (ddDir) ddDir.style.display = 'none';
    return;
  }
  const options = filterDirMap[type] || [];
  if (!ddDir) return;
  const menu = ddDir.querySelector('.filter-dd-menu');
  let html = '<li data-val="" class="filter-dd-option selected" onclick="selectDD(\'dd-dir\',\'\',\'全部\')">全部</li>';
  options.forEach(function (d) {
    html +=
      '<li data-val="' +
      d +
      '" class="filter-dd-option" onclick="selectDD(\'dd-dir\',\'' +
      d +
      "','" +
      d +
      '\')">' +
      d +
      '</li>';
  });
  if (menu) menu.innerHTML = html;
  ddDir.setAttribute('data-val', '');
  const textEl = ddDir.querySelector('.filter-dd-text');
  if (textEl) textEl.textContent = '全部';
  ddDir.style.display = 'block';
}

export function onRankTypeChange() {
  const type = getDDVal('dd-rankType');
  const ddRank = document.getElementById('dd-rank');
  if (type === '全部') {
    if (ddRank) ddRank.style.display = 'none';
    return;
  }
  if (ddRank) {
    ddRank.style.display = 'block';
    // 默认选中"第一名"（rankTop=1），避免用户选了"每天"但 rankTop=0 过滤不生效
    ddRank.setAttribute('data-val', '1');
    const textEl = ddRank.querySelector('.filter-dd-text');
    if (textEl) textEl.textContent = '第一名';
    // 同步更新下拉菜单选中状态
    ddRank.querySelectorAll('.filter-dd-option').forEach(function (o) {
      o.classList.toggle('selected', o.getAttribute('data-val') === '1');
    });
  }
}

export function doFilterQuery() {
  const league = getDDVal('dd-league');
  const timeRange = getDDVal('dd-time');
  const directionType = getDDVal('dd-dirType');
  const ddDir = document.getElementById('dd-dir');
  let direction = ddDir && ddDir.style.display !== 'none' ? getDDVal('dd-dir') : '';
  if (direction === '全部') direction = '';
  const rankType = getDDVal('dd-rankType') || '全部';
  let rankTop = 0;
  if (rankType !== '全部') {
    rankTop = parseInt(getDDVal('dd-rank')) || 0;
  }

  const resultEl = document.getElementById('filterResult');
  if (!resultEl) return;
  resultEl.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载中...</div>';

  api('hit-rate-filter', {
    league: league,
    timeRange: timeRange,
    directionType: directionType,
    direction: direction,
    rankType: rankType,
    rankTop: rankTop,
  })
    .then(function (data) {
      if (!data) {
        resultEl.innerHTML = '<div class="loading">查询失败</div>';
        return;
      }

      let html = '';
      if (data.totalCount === 0) {
        html += '<div class="loading" style="padding:20px;color:var(--text2)">暂无符合条件的数据</div>';
      } else {
        const rateVal = parseFloat(data.hitRate) || 0;
        const ringColor = rateVal >= 50 ? '#34D399' : rateVal >= 40 ? '#FBBF24' : '#EF4444';
        const r = 36,
          c = 2 * Math.PI * r;
        const dashLen = (c * rateVal) / 100;

        const condTags = data.conditionSummary.split(' | ');
        let condHtml = '<div class="filter-cond-tags">';
        for (let i = 0; i < condTags.length; i++) {
          if (i > 0) condHtml += '<span class="filter-cond-pipe">|</span>';
          condHtml += '<span>' + condTags[i] + '</span>';
        }
        condHtml += '</div>';

        html += '<div class="filter-result-card">';
        html += '<div class="filter-result-head">筛选结果</div>';
        html += condHtml;
        html += '<div class="filter-result-row">';
        html +=
          '<div class="filter-result-side"><div class="filter-result-num">' +
          data.hitCount +
          '</div><div class="filter-result-label">命中场次</div></div>';
        html += '<div class="filter-ring-wrap">';
        html += '<svg class="filter-ring-svg" viewBox="0 0 80 80">';
        html += '<circle class="filter-ring-bg" cx="40" cy="40" r="' + r + '"/>';
        html +=
          '<circle class="filter-ring-fill" cx="40" cy="40" r="' +
          r +
          '" stroke="' +
          ringColor +
          '" stroke-dasharray="' +
          dashLen +
          ' ' +
          c +
          '" stroke-dashoffset="0"/>';
        html +=
          '<text class="filter-ring-pct" x="40" y="40" text-anchor="middle" dominant-baseline="central" fill="' +
          ringColor +
          '" transform="rotate(90,40,40)">' +
          rateVal +
          '%</text>';
        html += '</svg></div>';
        html +=
          '<div class="filter-result-side"><div class="filter-result-num">' +
          data.totalCount +
          '</div><div class="filter-result-label">符合条件场次</div></div>';
        html += '</div></div>';
      }

      if (data.dailyResults && data.dailyResults.length > 0) {
        html += '<div class="filter-detail-card">';
        html += '<div class="filter-detail-head">按天汇总</div>';
        html +=
          '<table class="filter-detail-table"><thead><tr>' +
          '<th class="fdt-date">日期</th>' +
          '<th class="fdt-match">符合场次</th>' +
          '<th class="fdt-match">命中场次</th>' +
          '<th class="fdt-res">命中率</th>' +
          '</tr></thead><tbody>';
        data.dailyResults.forEach(function (d) {
          const dr = parseFloat(d.hitRate) || 0;
          html +=
            '<tr>' +
            '<td class="fdt-date">' +
            d.date.slice(5).replace('-', '/') +
            '</td>' +
            '<td class="fdt-match">' +
            d.totalMatch +
            '</td>' +
            '<td class="fdt-match">' +
            d.hitMatch +
            '</td>' +
            '<td class="fdt-res">' +
            dr.toFixed(1) +
            '%</td>' +
            '</tr>';
        });
        html += '</tbody></table></div>';
      }

      // 明细表格：每场比赛 × 方向命中详情
      if (data.detailList && data.detailList.length > 0) {
        // 按日期分组排序
        const sortedItems = data.detailList.slice().sort(function (a, b) {
          if (a.date !== b.date) return b.date.localeCompare(a.date);
          return a.matchId.localeCompare(b.matchId);
        });
        // 仅展示前 200 条，避免DOM过大
        const displayItems = sortedItems.slice(0, 200);
        html += '<div class="filter-detail-card">';
        html +=
          '<div class="filter-detail-head">命中明细' +
          (sortedItems.length > 200
            ? ' <span style="color:var(--text3);font-weight:400;font-size:11px">(仅展示前200条)</span>'
            : '') +
          '</div>';
        html +=
          '<table class="filter-detail-table"><thead><tr>' +
          '<th class="fdt-date">日期</th>' +
          '<th class="fdt-league">联赛</th>' +
          '<th class="fdt-match">比赛</th>' +
          '<th class="fdt-dir">方向</th>' +
          '<th class="fdt-exp">专家数</th>' +
          '<th class="fdt-res">结果</th>' +
          '</tr></thead><tbody>';
        displayItems.forEach(function (item) {
          const isFinished = (item.matchStatus || 0) >= 2;
          let resClass = '';
          let resText = '-';
          if (isFinished) {
            if (item.result == 1) {
              resClass = 'fdt-hit';
              resText = '✓ 命中';
            } else if (item.result == 0) {
              resClass = 'fdt-miss';
              resText = '✗ 未中';
            }
          }
          html +=
            '<tr>' +
            '<td class="fdt-date">' +
            (item.date || '').slice(5) +
            '</td>' +
            '<td class="fdt-league">' +
            (item.leagueName || '-') +
            '</td>' +
            '<td class="fdt-match" title="' +
            (item.homeName || '') +
            ' vs ' +
            (item.visitName || '') +
            '">' +
            (item.num || item.matchId || '-') +
            '</td>' +
            '<td class="fdt-dir">' +
            (item.direction || '-') +
            '</td>' +
            '<td class="fdt-exp">' +
            (item.expertCount || 0) +
            '</td>' +
            '<td class="fdt-res ' +
            resClass +
            '">' +
            resText +
            '</td>' +
            '</tr>';
        });
        html += '</tbody></table></div>';
      }

      resultEl.innerHTML = html;
    })
    .catch(function (e) {
      resultEl.innerHTML = '<div class="loading">' + e.message + '</div>';
    });
}
