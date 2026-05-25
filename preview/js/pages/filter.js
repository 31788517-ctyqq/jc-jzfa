import { api } from '../api.js';

export const filterDirMap = {
  '胜平负': ['全部', '胜', '平', '负'],
  '让球': ['全部', '让胜', '让平', '让负'],
  '进球数': ['全部', '总进球-1、2球', '总进球-2、3球', '总进球-3、4球', '总进球-1、2、3球', '总进球-2、3、4球', '总进球-3、4、5球'],
  '双选': ['全部', '平、让平', '让胜、让平', '让平、让负', '胜、平', '平、负'],
  '半全场': ['全部', '半全场-胜胜', '半全场-负负']
};

export function toggleDD(id, evt) {
  if (evt) { evt.stopPropagation(); evt.preventDefault(); }
  var dd = document.getElementById(id);
  if (!dd) return;
  var wasOpen = dd.classList.contains('open');
  closeAllDD();
  if (!wasOpen) {
    dd.classList.add('open');
    var menu = dd.querySelector('.filter-dd-menu');
    var trigger = dd.querySelector('.filter-dd-trigger');
    if (!menu || !trigger) return;
    var rect = trigger.getBoundingClientRect();
    var vh = window.innerHeight;
    var menuH = Math.min(menu.scrollHeight || 220, 220);
    var spaceBelow = vh - rect.bottom - 6;
    var spaceAbove = rect.top - 6;
    menu.style.position = 'fixed';
    menu.style.left = rect.left + 'px';
    menu.style.width = rect.width + 'px';
    menu.style.right = 'auto';
    menu.style.maxHeight = menuH + 'px';
    menu.style.overflowY = 'auto';
    menu.style.WebkitOverflowScrolling = 'touch';
    if (spaceBelow >= menuH || spaceBelow >= spaceAbove) {
      menu.style.top = (rect.bottom + 6) + 'px';
      menu.style.bottom = 'auto';
    } else {
      menu.style.bottom = (vh - rect.top + 6) + 'px';
      menu.style.top = 'auto';
    }
  }
}

export function selectDD(id, val, text) {
  var dd = document.getElementById(id);
  if (!dd) return;
  dd.setAttribute('data-val', val);
  var textEl = dd.querySelector('.filter-dd-text');
  if (textEl) textEl.textContent = text;
  dd.querySelectorAll('.filter-dd-option').forEach(function (o) {
    o.classList.toggle('selected', o.getAttribute('data-val') === val);
  });
  closeAllDD();
}

export function getDDVal(id) {
  var el = document.getElementById(id);
  return el ? (el.getAttribute('data-val') || '') : '';
}

export function closeAllDD() {
  document.querySelectorAll('.filter-dd.open').forEach(function (d) { d.classList.remove('open'); });
}

export function handleDocClose(e) {
  if (!e.target) return;
  var inDD = e.target.closest('.filter-dd');
  if (!inDD) closeAllDD();
}

export function resetFilterResult() {
  var el = document.getElementById('filterResult');
  if (el) el.innerHTML = '<div class="hint-box">选择筛选条件后点击"查询"按钮</div>';
}

export function loadFilterLeagues() {
  api('filter-stats', {}).then(function (stats) {
    var sm = document.getElementById('statMatches');
    var sl = document.getElementById('statLeagues');
    var sd = document.getElementById('statDirs');
    if (sm) sm.textContent = stats.matchCount || 0;
    if (sl) sl.textContent = stats.leagueCount || 0;
    if (sd) sd.textContent = stats.directionCount || 0;
    var ddLeague = document.getElementById('dd-league');
    if (ddLeague) {
      var menu = ddLeague.querySelector('.filter-dd-menu');
      var html = '<li data-val="" class="filter-dd-option selected" onclick="selectDD(\'dd-league\',\'\',\'全部\')">全部</li>';
      (stats.leagues || []).forEach(function (l) {
        html += '<li data-val="' + l + '" class="filter-dd-option" onclick="selectDD(\'dd-league\',\'' + l + '\',\'' + l + '\')">' + l + '</li>';
      });
      if (menu) menu.innerHTML = html;
    }
    if (stats.staleCount > 0) {
      var fr = document.getElementById('filterResult');
      if (fr) fr.innerHTML =
        '<div class="hint-box" style="color:var(--amber);font-size:12px;">' +
        '\u26A0 ' + stats.staleCount + ' 条推荐结果尚未确定，可能需要回填。<br>' +
        '<span style="color:var(--text3);">运行 <code>node backfill_results.js</code> 补全数据</span></div>';
    }
  }).catch(function () {
    var sm2 = document.getElementById('statMatches');
    var sl2 = document.getElementById('statLeagues');
    var sd2 = document.getElementById('statDirs');
    if (sm2) sm2.textContent = '-';
    if (sl2) sl2.textContent = '-';
    if (sd2) sd2.textContent = '-';
  });
}

export function onDDTypeChange() {
  var type = getDDVal('dd-dirType');
  var ddDir = document.getElementById('dd-dir');
  if (!type || type === '综合排名') { if (ddDir) ddDir.style.display = 'none'; return; }
  var options = filterDirMap[type] || [];
  if (!ddDir) return;
  var menu = ddDir.querySelector('.filter-dd-menu');
  var html = '<li data-val="" class="filter-dd-option selected" onclick="selectDD(\'dd-dir\',\'\',\'全部\')">全部</li>';
  options.forEach(function (d) {
    html += '<li data-val="' + d + '" class="filter-dd-option" onclick="selectDD(\'dd-dir\',\'' + d + '\',\'' + d + '\')">' + d + '</li>';
  });
  if (menu) menu.innerHTML = html;
  ddDir.setAttribute('data-val', '');
  var textEl = ddDir.querySelector('.filter-dd-text');
  if (textEl) textEl.textContent = '全部';
  ddDir.style.display = 'block';
}

export function onRankTypeChange() {
  var type = getDDVal('dd-rankType');
  var ddRank = document.getElementById('dd-rank');
  if (type === '全部') { if (ddRank) ddRank.style.display = 'none'; return; }
  if (ddRank) {
    ddRank.style.display = 'block';
    ddRank.setAttribute('data-val', '0');
    var textEl = ddRank.querySelector('.filter-dd-text');
    if (textEl) textEl.textContent = '全部';
  }
}

export function doFilterQuery() {
  var league = getDDVal('dd-league');
  var timeRange = getDDVal('dd-time');
  var directionType = getDDVal('dd-dirType');
  var ddDir = document.getElementById('dd-dir');
  var direction = (ddDir && ddDir.style.display !== 'none') ? getDDVal('dd-dir') : '';
  if (direction === '全部') direction = '';
  var rankType = getDDVal('dd-rankType') || '全部';
  var rankTop = 0;
  if (rankType !== '全部') { rankTop = parseInt(getDDVal('dd-rank')) || 0; }

  var resultEl = document.getElementById('filterResult');
  if (!resultEl) return;
  resultEl.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载中...</div>';

  api('hit-rate-filter', {
    league: league,
    timeRange: timeRange,
    directionType: directionType,
    direction: direction,
    rankType: rankType,
    rankTop: rankTop
  }).then(function (data) {
    if (!data) {
      resultEl.innerHTML = '<div class="loading">查询失败</div>';
      return;
    }

    var html = '';
    if (data.totalCount === 0) {
      html += '<div class="loading" style="padding:20px;color:var(--text2)">暂无符合条件的数据</div>';
    } else {
      var rateVal = parseFloat(data.hitRate) || 0;
      var ringColor = rateVal >= 50 ? '#34D399' : rateVal >= 40 ? '#FBBF24' : '#EF4444';
      var r = 36, c = 2 * Math.PI * r;
      var dashVal = c * (1 - rateVal / 100);

      var condTags = data.conditionSummary.split(' | ');
      var condHtml = '<div class="filter-cond-tags">';
      for (var i = 0; i < condTags.length; i++) {
        if (i > 0) condHtml += '<span class="filter-cond-pipe">|</span>';
        condHtml += '<span>' + condTags[i] + '</span>';
      }
      condHtml += '</div>';

      html += '<div class="filter-result-card">';
      html += '<div class="filter-result-head">筛选结果</div>';
      html += condHtml;
      html += '<div class="filter-result-row">';
      html += '<div class="filter-result-side"><div class="filter-result-num">' + data.hitCount + '</div><div class="filter-result-label">命中场次</div></div>';
      html += '<div class="filter-ring-wrap">';
      html += '<svg class="filter-ring-svg" viewBox="0 0 80 80">';
      html += '<circle class="filter-ring-bg" cx="40" cy="40" r="' + r + '"/>';
      html += '<circle class="filter-ring-fill" cx="40" cy="40" r="' + r + '" stroke="' + ringColor + '" stroke-dasharray="' + c + '" stroke-dashoffset="' + dashVal + '"/>';
      html += '<text class="filter-ring-pct" x="40" y="40" text-anchor="middle" dominant-baseline="central" fill="' + ringColor + '" transform="rotate(90,40,40)">' + rateVal + '%</text>';
      html += '</svg></div>';
      html += '<div class="filter-result-side"><div class="filter-result-num">' + data.totalCount + '</div><div class="filter-result-label">符合条件场次</div></div>';
      html += '</div></div>';
    }

    if (data.dailyResults && data.dailyResults.length > 0) {
      html += '<div class="filter-detail-card">';
      html += '<div class="filter-detail-head">结果详情</div>';
      html += '<div class="filter-detail-header-row"><span>近15天</span><span>符合场次/命中场次</span><span>命中率</span></div>';
      data.dailyResults.forEach(function (d) {
        var dr = parseFloat(d.hitRate) || 0;
        html += '<div class="filter-detail-row"><span>' + d.date + '</span><span>' + d.totalMatch + '/' + d.hitMatch + '</span><span>' + dr.toFixed(1) + '%</span></div>';
      });
      html += '</div>';
    }

    resultEl.innerHTML = html;
  }).catch(function (e) {
    resultEl.innerHTML = '<div class="loading">' + e.message + '</div>';
    window.incomeLoaded = false;
  });
}
