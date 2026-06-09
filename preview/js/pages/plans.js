import { api } from '../api.js';
import { WEEK_NAMES, MIN_PLAN_DATE, formatDate, getCache, setCache } from '../utils.js';
import * as state from '../state.js';

/**
 * 渲染对阵文本：有比分则显示蓝色比分替代 VS，否则显示 VS
 * @param {Object} m - match 对象 (含 homeName, visitName, actualScore, isMatchWon/isMatchLose)
 */
function renderMatchTeams(m) {
  var hasResult =
    (m.isMatchWon !== null && m.isMatchWon !== undefined) ||
    (m.isMatchLose !== null && m.isMatchLose !== undefined) ||
    (m.isScoreWon !== null && m.isScoreWon !== undefined) ||
    (m.isScoreLose !== null && m.isScoreLose !== undefined);
  var score = m.actualScore || '';

  // ★ 提取让球数：优先从 odds.rqspf.handicap，其次 odds.handicap
  var handicap = null;
  if (m.odds && m.odds.rqspf && m.odds.rqspf.handicap != null) {
    handicap = Number(m.odds.rqspf.handicap);
  } else if (m.odds && m.odds.handicap != null) {
    handicap = Number(m.odds.handicap);
  }
  var handicapStr = '';
  if (handicap !== null && handicap !== 0) {
    handicapStr = handicap > 0 ? '(+' + handicap + ')' : '(' + handicap + ')';
  } else if (handicap === 0) {
    handicapStr = '(0)';
  }

  if (hasResult && score) {
    return (
      '<span class="plan-team-home">' +
      (m.homeName || '') +
      '</span><span class="plan-score-blue">' +
      score +
      handicapStr +
      '</span>' +
      '<span class="plan-team-away">' +
      (m.visitName || '') +
      '</span>'
    );
  }
  return (
    '<span class="plan-team-home">' +
    (m.homeName || '') +
    '</span><span class="plan-team-vs">vs</span>' +
    '<span class="plan-team-away">' +
    (m.visitName || '') +
    '</span>'
  );
}

export function updatePlanDateBar() {
  var d = new Date();
  d.setDate(d.getDate() + state.planDateOffset);
  state.setPlanDate(
    d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'),
  );
  var el = document.getElementById('planDateCurrent');
  if (!el) return;
  var today = new Date();
  var todayStr =
    today.getFullYear() +
    '-' +
    String(today.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(today.getDate()).padStart(2, '0');
  var prefix = state.planDate === todayStr ? '今天 ' : '';
  var mmdd = state.planDate.slice(5).replace('-', '/');
  var week = WEEK_NAMES[new Date(state.planDate).getDay()];
  el.textContent = prefix + mmdd + ' ' + week;

  // 日期导航智能停靠：到达最早/最晚日期时箭头视觉禁用
  var arrows = document.querySelectorAll('#planDateBar .date-arrow');
  var bar = document.getElementById('planDateBar');
  if (bar && arrows.length >= 2) {
    arrows[0].style.opacity = state.planDate <= MIN_PLAN_DATE ? '0.25' : '0.7';
    arrows[0].style.pointerEvents = state.planDate <= MIN_PLAN_DATE ? 'none' : 'auto';
    arrows[1].style.opacity = state.planDate >= todayStr ? '0.25' : '0.7';
    arrows[1].style.pointerEvents = state.planDate >= todayStr ? 'none' : 'auto';
  }
}

function _normalizeVisiblePlanTab(tab) {
  return tab === 'my' ? 'my' : 'expert';
}

function _syncPlanTabBarLayout() {
  var bar = document.getElementById('planTabBar');
  if (!bar) return;
  bar.style.justifyContent = 'flex-start';
  bar.style.gap = '6px';
}

function _loadActivePlanTab() {
  var visibleTab = _normalizeVisiblePlanTab(state.planTab);
  _syncPlanTabBarLayout();
  if (visibleTab !== state.planTab) state.setPlanTab(visibleTab);
  if (visibleTab === 'my') loadMyPlanList();
  else loadPlanList();
}

export function shiftPlanDate(delta) {
  state.setPlanDateExplicit(false);
  var newOffset = state.planDateOffset + delta;
  var d = new Date();
  d.setDate(d.getDate() + newOffset);
  var newDate =
    d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  if (newDate < MIN_PLAN_DATE) return;
  // 前向限制：不能超过今天
  var todayStr = formatDate(new Date());
  if (newDate > todayStr) return;
  state.setPlanDateOffset(newOffset);
  updatePlanDateBar();
  _loadActivePlanTab();
}

export function goPlanToday() {
  state.setPlanDateExplicit(false);
  state.setPlanDateOffset(0);
  updatePlanDateBar();
  _loadActivePlanTab();
}

// 智能日期停靠：页面加载时定位到 weekDates 中 <= 今天的最近日期
export function _autoSetBestDate() {
  var weekDates = state.weekDates || [];
  if (weekDates.length === 0) return;
  var today = formatDate(new Date());
  var todayMD = today.slice(5);
  var dates = weekDates.map(function (w) {
    return w.matchDate;
  });
  // 如果今天有比赛数据，直接待在今天
  if (dates.indexOf(todayMD) >= 0) return;
  // 否则找到 <= 今天的最新日期
  var latestMD = '';
  dates.forEach(function (md) {
    if (md <= todayMD && md > latestMD) latestMD = md;
  });
  if (latestMD) {
    var d = new Date();
    var latestDate = new Date(d.getFullYear(), parseInt(latestMD.slice(0, 2), 10) - 1, parseInt(latestMD.slice(3), 10));
    var diffDays = Math.ceil((d.getTime() - latestDate.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays > 0) {
      state.setPlanDateOffset(-diffDays);
      updatePlanDateBar();
    }
  }
}

export function switchPlanTab(tab) {
  var visibleTab = _normalizeVisiblePlanTab(tab);
  _syncPlanTabBarLayout();
  state.setPlanTab(visibleTab);

  document.querySelectorAll('#planTabBar .filter-tag').forEach(function (btn) {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === visibleTab);
  });
  // ★ 自动滚动使激活标签完整可见，但不再把整个标签栏推向右侧
  var activeTag = document.querySelector('#planTabBar .filter-tag[data-tab="' + visibleTab + '"]');
  if (activeTag) {
    activeTag.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }

  if (visibleTab === 'my') loadMyPlanList();
  else loadPlanList();
}

export function loadPlanList() {
  var el = document.getElementById('planList');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载方案中...</div>';

  // 日历直接选日时强制发送日期；offset=0且非显式选日则不传日期让服务器选最新
  var params;
  if (state.planDateExplicit) {
    params = { date: state.planDate };
  } else if (state.planDateOffset === 0) {
    params = { date: state.planDate };
  } else {
    params = { date: state.planDate };
  }

  // ★ P1: sessionStorage 缓存命中
  var cacheKey = 'plan-list:' + state.planDate;
  var cached = getCache(cacheKey);
  if (cached) {
    el.innerHTML = cached;
    return;
  }

  // ★ 蓝图：并行获取共识数据
  var consensusPromise = api('batch-consensus', { date: state.planDate }).catch(function () {
    return null;
  });

  api('plan-list', params)
    .then(function (data) {
      return consensusPromise.then(function (consensusMap) {
        return { data: data, consensusMap: consensusMap || {} };
      });
    })
    .then(function (ctx) {
      var data = ctx.data;
      var consensusMap = ctx.consensusMap;
      // 用服务器返回的实际日期更新显示（日历显式选日时不过度覆盖）
      if (data.date && data.date !== state.planDate && !state.planDateExplicit) {
        state.setPlanDate(data.date);
        var planEl = document.getElementById('planDateCurrent');
        if (planEl) {
          var mmdd = data.date.slice(5).replace('-', '/');
          var week = WEEK_NAMES[new Date(data.date).getDay()];
          planEl.textContent = mmdd + ' ' + week;
        }
      }
      var plans = data.plans || [];
      // ★ notice 提示条（有方案时嵌入顶部）
      var noticeHtml = data.notice
        ? '<div style="background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.15);border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:12px;color:#fbbf24;text-align:center;">⚠ ' +
          data.notice +
          '</div>'
        : '';
      if (plans.length === 0) {
        var now = new Date();
        var todayStr =
          now.getFullYear() +
          '-' +
          String(now.getMonth() + 1).padStart(2, '0') +
          '-' +
          String(now.getDate()).padStart(2, '0');
        // 今天的方案为空 → 自动回退到最近有数据的一天
        if (state.planDate === todayStr) {
          var d2 = new Date();
          d2.setDate(d2.getDate() + state.planDateOffset - 1);
          var prevDateStr =
            d2.getFullYear() +
            '-' +
            String(d2.getMonth() + 1).padStart(2, '0') +
            '-' +
            String(d2.getDate()).padStart(2, '0');
          if (prevDateStr >= MIN_PLAN_DATE) {
            state.setPlanDateOffset(state.planDateOffset - 1);
            // 强制切到专家博热方案标签
            if (state.planTab !== 'expert') {
              state.setPlanTab('expert');
              document.querySelectorAll('#planTabBar .filter-tag').forEach(function (btn) {
                btn.classList.toggle('active', btn.getAttribute('data-tab') === 'expert');
              });
            }
            updatePlanDateBar();
            loadPlanList();
            return;
          }
        }
        // 无法回退 或 非今日：显示提示/notice
        if (data.notice) {
          el.innerHTML =
            '<div style="text-align:center;padding:80px 0;color:var(--text3);font-size:14px;">' +
            data.notice +
            '</div>';
        } else {
          el.innerHTML =
            '<div style="text-align:center;padding:80px 0;color:var(--text3);font-size:14px;">当日暂无竞彩方案</div>';
        }
        return;
      }

      // ★ 共识过滤版块已隐藏
      var filterBar = '';
      var displayPlans = plans;

      var html = displayPlans
        .map(function (p, i) {
          var matches = p.matches || [];
          var isWon = false,
            isLose = false;
          var allWon = matches.length > 0;
          var anyLose = false,
            anyUndetermined = false;
          for (var mi2 = 0; mi2 < matches.length; mi2++) {
            if (!matches[mi2].isMatchWon) allWon = false;
            if (matches[mi2].isMatchLose) anyLose = true;
            if (!matches[mi2].isMatchWon && !matches[mi2].isMatchLose) anyUndetermined = true;
          }
          isWon = allWon;
          isLose = anyLose && !isWon;
          if (anyUndetermined) {
            isWon = false;
            isLose = false;
          }

          var planName = p.planName || '专家博热方案 ' + (i + 1);
          var amountVal = (p.amount || 1000).toFixed(0);
          // ★ 不要覆盖上面从 matches[].isMatchWon/isMatchLose 计算出的 isWon/isLose
          var prizeNum = isWon ? p.winningPrize || 0 : isLose ? 0 : p.maxPrize || 0;
          var prizeVal = prizeNum > 0 ? prizeNum.toFixed(0) : isWon ? '--' : '0';
          var prizeLabel = isWon || isLose ? '中奖金额' : '预计最高奖金';
          var statusText = isWon ? '已中奖' : isLose ? '未中奖' : '未开奖';

          var cutoffDisplay = '';
          if (matches.length > 0 && matches[0].startTime) {
            var stParts = matches[0].startTime.match(/(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
            if (stParts) {
              var stMonth = parseInt(stParts[1]) - 1,
                stDay = parseInt(stParts[2]),
                stHour = parseInt(stParts[3]),
                stMin = parseInt(stParts[4]);
              var pYear = parseInt(state.planDate.slice(0, 4));
              var kickoff = new Date(pYear, stMonth, stDay, stHour, stMin);
              if (!isNaN(kickoff.getTime())) {
                var mp = state.planDate.split('-');
                var matchDateOnly = new Date(parseInt(mp[0]), parseInt(mp[1]) - 1, parseInt(mp[2]));
                var kickoffDateOnly = new Date(kickoff.getFullYear(), kickoff.getMonth(), kickoff.getDate());
                var isCrossMidnight = kickoffDateOnly > matchDateOnly;
                var cutoff;
                if (isCrossMidnight) {
                  var matchDow = matchDateOnly.getDay();
                  if (matchDow >= 1 && matchDow <= 5)
                    cutoff = new Date(parseInt(mp[0]), parseInt(mp[1]) - 1, parseInt(mp[2]), 21, 30);
                  else cutoff = new Date(parseInt(mp[0]), parseInt(mp[1]) - 1, parseInt(mp[2]), 22, 30);
                } else {
                  cutoff = new Date(kickoff.getTime() - 30 * 60 * 1000);
                  var dow = kickoff.getDay();
                  if (dow >= 1 && dow <= 5 && stHour >= 22) cutoff = new Date(pYear, stMonth, stDay, 21, 30);
                  else if ((dow === 0 || dow === 6) && stHour >= 23) cutoff = new Date(pYear, stMonth, stDay, 22, 30);
                }
                var pad2 = function (n) {
                  return String(n).padStart(2, '0');
                };
                cutoffDisplay =
                  '截单时间：' +
                  pad2(cutoff.getMonth() + 1) +
                  '/' +
                  pad2(cutoff.getDate()) +
                  ' ' +
                  pad2(cutoff.getHours()) +
                  ':' +
                  pad2(cutoff.getMinutes());
              }
            }
          }

          function resolveMatchOddsHtml(match, planIdx) {
            var dir = match.direction || '';
            // 单关双选方向展开：胜平→胜、平，平负→平、负
            if (dir === '胜平') dir = '胜、平';
            else if (dir === '平负') dir = '平、负';
            var oddsObj = match.odds || {};
            var parts = dir ? dir.split(/[、，,]/) : [];
            var subResults = match.subResults || [];
            var resolved = [];
            var commonPrefix = '';
            if (parts.length > 1 && parts[0].length > 1) {
              for (var cl = 1; cl <= parts[0].length; cl++) {
                var cand = parts[0].substring(0, cl);
                var ok = true;
                for (var pi = 1; pi < parts.length; pi++) {
                  if (parts[pi].indexOf(cand) !== 0) {
                    ok = false;
                    break;
                  }
                }
                if (!ok) break;
                commonPrefix = cand;
              }
            }
            parts.forEach(function (pt) {
              var label = pt.trim();
              var ft = commonPrefix ? commonPrefix + label.replace(commonPrefix, '') : label.trim();
              var val = null;
              var isRQ = false;
              if (ft === '让胜' || ft.indexOf('让胜') >= 0) {
                val = oddsObj.rqspf && oddsObj.rqspf.home;
                isRQ = true;
              } else if (ft === '让平' || ft.indexOf('让平') >= 0) {
                val = oddsObj.rqspf && oddsObj.rqspf.draw;
                isRQ = true;
              } else if (ft === '让负' || ft.indexOf('让负') >= 0) {
                val = oddsObj.rqspf && oddsObj.rqspf.away;
                isRQ = true;
              } else if (ft.indexOf('总进球') >= 0 && oddsObj.totalGoals) {
                var gm = ft.match(/(\d+\+?)/);
                if (gm) val = oddsObj.totalGoals[gm[1]];
              }
              if (!val && ft.indexOf('球') >= 0 && oddsObj.totalGoals) {
                var gm2 = ft.match(/(\d+\+?)/);
                if (gm2) val = oddsObj.totalGoals[gm2[1]];
              }
              // 半全场方向（半全场-胜胜、半全场-平胜 等）
              var isHalfFull = ft.indexOf('半全场-') === 0;
              if (!val && isHalfFull && oddsObj.halfFull) {
                var hfName = ft.replace('半全场-', '');
                var hfMap = {
                  胜胜: 'hh',
                  平胜: 'dh',
                  胜负: 'ha',
                  胜平: 'hd',
                  平平: 'dd',
                  平负: 'da',
                  负胜: 'ah',
                  负平: 'ad',
                  负负: 'aa',
                };
                var hfKey = hfMap[hfName];
                if (hfKey) val = oddsObj.halfFull[hfKey];
              }
              // ★ 半全场无赔率数据时不回退到SPF（SPF赔率与半全场差异太大）
              if (!val && !isRQ && !isHalfFull) {
                if (ft.indexOf('胜') >= 0 && ft.length <= 2) val = oddsObj.spf && oddsObj.spf.home;
                else if (ft.indexOf('平') >= 0 && ft.length <= 2) val = oddsObj.spf && oddsObj.spf.draw;
                else if (ft.indexOf('负') >= 0 && ft.length <= 2) val = oddsObj.spf && oddsObj.spf.away;
              }
              if (!val && !isRQ && oddsObj.spf) val = oddsObj.spf.home || oddsObj.spf.draw || oddsObj.spf.away;
              var subR = null;
              for (var si = 0; si < subResults.length; si++) {
                if (subResults[si].direction === label) {
                  subR = subResults[si];
                  break;
                }
              }
              var subColor = '#fff';
              if (subR && subR.result !== null && subR.result !== undefined) {
                subColor = subR.result === 1 ? '#EF4444' : '#22C55E';
              }
              var displayLabel = label;
              if (displayLabel.indexOf('总进球-') === 0) {
                displayLabel = displayLabel.replace('总进球-', '');
                if (displayLabel.indexOf('球') < 0) displayLabel += '球';
              }
              if (displayLabel.indexOf('半全场-') === 0) {
                displayLabel = displayLabel.replace('半全场-', '');
              }
              if (val) resolved.push('<span style="color:' + subColor + '">' + displayLabel + '(' + val + ')</span>');
              else resolved.push('<span style="color:' + subColor + '">' + displayLabel + '(-)</span>');
            });
            return resolved.join('<span style="color:#fff"> + </span>');
          }

          var matchRows = '';
          for (var mi4 = 0; mi4 < matches.length; mi4++) {
            var m = matches[mi4];
            var isMw = m.isMatchWon === true;
            var isMl = m.isMatchLose === true;
            var matchOddsHtml = resolveMatchOddsHtml(m, i);
            var numText = m.matchNum || '';
            var matchDateShort = '',
              matchTime = '';
            if (m.startTime) {
              var tm = m.startTime.match(/(\d{2}:\d{2})/);
              if (tm) matchTime = tm[1];
              var dm = m.startTime.match(/(\d{2})\/(\d{2})/) || m.startTime.match(/(\d{2})-(\d{2})/);
              if (dm) matchDateShort = dm[1] + '/' + dm[2];
            }
            var timeDisp = matchDateShort || matchTime ? (matchDateShort + ' ' + matchTime).trim() : '';
            matchRows +=
              '<tr>' +
              '<td class="match-info-col">' +
              '<div class="match-num-text">' +
              numText +
              '</div>' +
              (timeDisp ? '<div class="match-time-sub">' + timeDisp + '</div>' : '') +
              '</td>' +
              '<td class="team-col">' +
              renderMatchTeams(m) +
              '</td>' +
              '<td class="odds-col">' +
              matchOddsHtml +
              '</td>' +
              '</tr>';
          }

          var cardId = 'expert-' + i;
          return (
            '<div class="plan-card" id="upcard-' +
            cardId +
            '">' +
            '<div class="plan-card-head">' +
            '<div class="plan-left">' +
            '<span class="plan-soccer-icon"><img src="/assets/plan_icon.png?v=1" alt="" decoding="async"/></span>' +
            '<span class="plan-name">' +
            planName +
            '</span>' +
            '</div>' +
            '<span class="plan-pub-time">' +
            cutoffDisplay +
            '</span>' +
            (function () {
              /* eslint-disable no-undef */
              var matchIds = matches.map(function (m) {
                return m.matchId;
              });
              var best = null;
              matchIds.forEach(function (id) {
                var c = consensusMap[id];
                if (
                  c &&
                  (!best ||
                    (c.consensus === 'strong' && best.consensus !== 'strong') ||
                    (c.consensus === 'weak' && best.consensus === 'neutral'))
                )
                  best = c;
              });
              if (!best) return '';
              var cls = best.consensus === 'strong' ? 'strong' : best.consensus === 'weak' ? 'weak' : 'neutral';
              var txt =
                best.consensus === 'strong'
                  ? '共识' + best.agreeCount + '/' + best.totalCount
                  : best.consensus === 'weak'
                    ? '弱共识'
                    : '';
              return (
                '<span class="consensus-badge ' + cls + '" style="font-size:10px;margin-left:4px">' + txt + '</span>'
              );
            })() +
            (function () {
              /* eslint-disable no-undef */
              var matchIds = matches.map(function (m) {
                return m.matchId;
              });
              var best = null;
              matchIds.forEach(function (id) {
                var c = consensusMap[id];
                if (
                  c &&
                  (!best ||
                    (c.consensus === 'strong' && best.consensus !== 'strong') ||
                    (c.consensus === 'weak' && best.consensus === 'neutral'))
                )
                  best = c;
              });
              /* eslint-enable no-undef */
              if (!best) return '';
              var cls = best.consensus === 'strong' ? 'strong' : best.consensus === 'weak' ? 'weak' : 'neutral';
              var txt =
                best.consensus === 'strong'
                  ? '共识' + best.agreeCount + '/' + best.totalCount
                  : best.consensus === 'weak'
                    ? '弱共识'
                    : '';
              return (
                '<span class="consensus-badge ' + cls + '" style="font-size:10px;margin-left:6px">' + txt + '</span>'
              );
            })() +
            '</div>' +
            '<div class="plan-amount-row">' +
            '<div class="plan-amount-col">' +
            '<div class="plan-amount-label">方案金额</div>' +
            '<div class="plan-amount-value">' +
            amountVal +
            '<span class="unit">元</span></div>' +
            '</div>' +
            '<div class="plan-amount-col">' +
            '<div class="plan-amount-label">' +
            prizeLabel +
            '</div>' +
            '<div class="plan-amount-value">' +
            prizeVal +
            '<span class="unit">元</span></div>' +
            '</div>' +
            '<div class="plan-amount-col">' +
            '<div class="plan-amount-label">方案状态</div>' +
            '<div class="plan-amount-value">' +
            (isWon ? '已中奖' : isLose ? '未中奖' : '未开奖') +
            '</div>' +
            '</div>' +
            '</div>' +
            '<div class="plan-divider"></div>' +
            '<div class="plan-info-grid">' +
            '<div class="plan-info-left">' +
            '<div>玩法</div>' +
            '<div>场数/过关</div>' +
            '<div>注数/倍/票</div>' +
            '</div>' +
            '<div class="plan-info-right">' +
            '<div>' +
            (p.playType || '混合投注') +
            '</div>' +
            '<div>' +
            ((p.matchCount || 1) + '场' + (p.passType || '单关')) +
            '</div>' +
            '<div>' +
            (p.betCount || 250) +
            '注' +
            (p.multiplier || 25) +
            '倍' +
            (p.ticketCount || 10) +
            '票</div>' +
            '</div>' +
            (isWon
              ? '<div class="plan-win-stamp"><svg width="38" height="38" viewBox="0 0 38 38"><circle cx="19" cy="19" r="17" fill="none" stroke="#EF4444" stroke-width="2"/><text x="19" y="25" text-anchor="middle" font-size="18" font-weight="900" fill="#EF4444" transform="rotate(-10,19,19)">中</text></svg></div>'
              : '') +
            (isLose
              ? '<div class="plan-lose-stamp"><svg width="38" height="38" viewBox="0 0 38 38"><circle cx="19" cy="19" r="17" fill="none" stroke="#9AA6B2" stroke-width="2"/><text x="19" y="25" text-anchor="middle" font-size="16" font-weight="900" fill="#9AA6B2" transform="rotate(-10,19,19)">未中</text></svg></div>'
              : '') +
            '</div>' +
            '<div class="plan-match-section">' +
            '<table class="plan-match-table">' +
            '<thead><tr><th>场次</th><th>对阵</th><th>方向(赔率)</th></tr></thead>' +
            '<tbody>' +
            matchRows +
            '</tbody>' +
            '</table>' +
            '</div>' +
            '<div class="mp-actions">' +
            '<button class="mp-share-btn" onclick="sharePlanCard(\'' +
            cardId +
            '\')">📤 分享</button>' +
            '</div>' +
            '</div>'
          );
        })
        .join('');
      setCache(cacheKey, html);
      el.innerHTML = filterBar + noticeHtml + html;
    })
    .catch(function (e) {
      el.innerHTML = '<div style="text-align:center;padding:80px 0;color:var(--text3);">' + e.message + '</div>';
    });
}

// ========== 我的方案 ==========
export function loadMyPlanList() {
  var el = document.getElementById('planList');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载我的方案中...</div>';

  api('my-plan-list', {})
    .then(function (data) {
      var plans = (data && data.plans) || [];

      // ★ 按当前选择的日期过滤方案
      var curDate = state.planDate || '';
      if (curDate && plans.length > 0) {
        plans = plans.filter(function (p) {
          // 方案日期优先从 createdAt 提取
          var planDate = '';
          if (p.date) planDate = p.date;
          else if (p.createdAt) planDate = p.createdAt.slice(0, 10);
          // 兜底：从比赛列表中提取日期
          if (!planDate && p.matches && p.matches.length > 0) {
            var firstMatch = p.matches[0];
            if (firstMatch._date) planDate = firstMatch._date;
          }
          return planDate === curDate;
        });
      }

      if (plans.length === 0) {
        el.innerHTML =
          '<div class="plan-notice">' + '<span class="notice-icon">&#x1F375;</span>' + '稍稍等，马上就来' + '</div>';
        return;
      }

      var html = plans
        .map(function (p, idx) {
          var matches = p.matches || [];
          var isWon = p.isWon === true;
          var isLose = p.isWon === false;
          var statusText = isWon ? '已中奖' : isLose ? '未中奖' : '未开奖';
          var statusColor = isWon ? '#EF4444' : isLose ? '#9AA6B2' : '#FFC928';
          var amountVal = (p.amount || 200).toFixed(0);
          var prizeLabel = isWon || isLose ? '中奖金额' : '预计最高奖金';
          // ★ 修复奖金计算公式：
          // totalOdds = maxWin / amount，所以预计最高奖金 = amount * totalOdds
          // 之前多除了 /p.multiplier 导致奖金被低估
          var prizeVal;
          if (isWon) {
            prizeVal = p.resultIncome != null ? '+' + p.resultIncome : '--';
          } else if (isLose) {
            prizeVal = '0';
          } else {
            var totalOdds = Number(p.totalOdds) || 0;
            var amount = Number(p.amount) || 0;
            if (totalOdds > 0 && amount > 0) {
              prizeVal = Math.round(totalOdds * amount * 100) / 100;
            } else {
              prizeVal = '--';
            }
          }
          // 按创建顺序编号：方案一、方案二、方案三...
          var _cnNums = [
            '',
            '一',
            '二',
            '三',
            '四',
            '五',
            '六',
            '七',
            '八',
            '九',
            '十',
            '十一',
            '十二',
            '十三',
            '十四',
            '十五',
            '十六',
            '十七',
            '十八',
            '十九',
            '二十',
            '二十一',
            '二十二',
            '二十三',
            '二十四',
            '二十五',
            '二十六',
            '二十七',
            '二十八',
            '二十九',
            '三十',
          ];
          var seqNum = idx + 1;
          var cnNum = seqNum <= 30 ? _cnNums[seqNum] : String(seqNum);
          var planName = '方案' + cnNum;
          var dateStr = p.date
            ? p.date.slice(5).replace('-', '/')
            : p.createdAt
              ? p.createdAt.slice(0, 10).slice(5)
              : '';

          var matchRows = '';
          for (var mi = 0; mi < matches.length; mi++) {
            var m = matches[mi];
            var oddsStr = m.odds != null ? Number(m.odds).toFixed(2) : '--';
            var dirDisplay = m.direction || m.oddsName || '';
            if (m.playType === 'rqspf') dirDisplay = '让' + dirDisplay;
            // 赔率颜色：未中奖绿色 / 中奖红色 / 未开奖白色
            var oddsColor = '#ffffff';
            if (m.isMatchWon === true) oddsColor = '#EF4444';
            else if (m.isMatchLose === true) oddsColor = '#22C55E';
            matchRows +=
              '<tr>' +
              '<td class="match-info-col">' +
              '<div class="match-num-text">' +
              (m.matchNum || '') +
              '</div>' +
              '</td>' +
              '<td class="team-col">' +
              renderMatchTeams(m) +
              '</td>' +
              '<td class="odds-col" style="color:' +
              oddsColor +
              '">' +
              dirDisplay +
              '(' +
              oddsStr +
              ')' +
              '</td>' +
              '</tr>';
          }

          var stampHtml = '';
          if (isWon) {
            stampHtml =
              '<div class="plan-win-stamp"><svg width="38" height="38" viewBox="0 0 38 38"><circle cx="19" cy="19" r="17" fill="none" stroke="#EF4444" stroke-width="2"/><text x="19" y="25" text-anchor="middle" font-size="18" font-weight="900" fill="#EF4444" transform="rotate(-10,19,19)">中</text></svg></div>';
          } else if (isLose) {
            stampHtml =
              '<div class="plan-lose-stamp"><svg width="38" height="38" viewBox="0 0 38 38"><circle cx="19" cy="19" r="17" fill="none" stroke="#9AA6B2" stroke-width="2"/><text x="19" y="25" text-anchor="middle" font-size="16" font-weight="900" fill="#9AA6B2" transform="rotate(-10,19,19)">未中</text></svg></div>';
          }

          return (
            '<div class="plan-card" id="upcard-' +
            p.id +
            '">' +
            '<div class="plan-card-head">' +
            '<div class="plan-left">' +
            '<span class="plan-soccer-icon"><img src="/assets/plan_icon.png?v=1" alt="" decoding="async"/></span>' +
            '<span class="plan-name">' +
            planName +
            '</span>' +
            '</div>' +
            '<span class="plan-pub-time">' +
            dateStr +
            '</span>' +
            '</div>' +
            '<div class="plan-amount-row">' +
            '<div class="plan-amount-col"><div class="plan-amount-label">方案金额</div><div class="plan-amount-value">' +
            amountVal +
            '<span class="unit">元</span></div></div>' +
            '<div class="plan-amount-col"><div class="plan-amount-label">' +
            prizeLabel +
            '</div><div class="plan-amount-value">' +
            prizeVal +
            '<span class="unit">元</span></div></div>' +
            '<div class="plan-amount-col"><div class="plan-amount-label">方案状态</div><div class="plan-amount-value" style="color:' +
            statusColor +
            ';">' +
            statusText +
            '</div></div>' +
            '</div>' +
            '<div class="plan-divider"></div>' +
            '<div class="plan-info-grid">' +
            '<div class="plan-info-left"><div>玩法</div><div>场数/过关</div><div>注数/倍数</div></div>' +
            '<div class="plan-info-right"><div>混合投注</div><div>' +
            (p.matchCount || matches.length) +
            '场 ' +
            ((p.passTypes || [2]).length > 1
              ? (p.passTypes || [2]).join('~') + '关'
              : ((p.passTypes || [2])[0] || 2) + '关') +
            '</div><div>' +
            (p.betCount || '--') +
            '注 ×' +
            (p.multiplier || 1) +
            '倍</div></div>' +
            stampHtml +
            '</div>' +
            '<div class="plan-match-section">' +
            '<table class="plan-match-table"><thead><tr><th>场次</th><th>对阵</th><th>方向(赔率)</th></tr></thead><tbody>' +
            matchRows +
            '</tbody></table></div>' +
            '<div class="mp-actions">' +
            '<button class="mp-delete-btn" onclick="deletePlanCard(\'' +
            p.id +
            '\')">&#x1F5D1; 删除</button>' +
            '<button class="mp-share-btn" onclick="sharePlanCard(\'' +
            p.id +
            '\')">&#x1F4E4; 分享</button>' +
            '</div>' +
            '</div>'
          );
        })
        .join('');
      el.innerHTML = html;

      // ★ 异步刷新赔率变动数据（仅"我的方案"需要实时趋势）
      refreshMyPlanDelta(plans);
    })
    .catch(function (e) {
      el.innerHTML =
        '<div style="text-align:center;padding:80px 0;color:var(--text3);">加载失败: ' + (e && e.message) + '</div>';
    });
}

// ═══ 自定义确认弹窗工厂 ═══
function _confirmDelete(planId, planName, onSuccess) {
  var overlay = document.createElement('div');
  overlay.className = 'del-overlay active';
  overlay.innerHTML =
    '<div class="del-modal">' +
    '<div class="del-modal-head">' +
    '<span class="del-modal-icon">&#x26A0;&#xFE0F;</span>' +
    '<span class="del-modal-title">确认删除</span>' +
    '</div>' +
    '<div class="del-modal-body">' +
    '<p>' +
    (planName ? '确定删除方案「' + planName + '」吗？' : '确定删除这个方案吗？') +
    '</p>' +
    '<p class="del-modal-sub">删除后无法恢复</p>' +
    '</div>' +
    '<div class="del-modal-foot">' +
    '<button class="del-btn-cancel">取消</button>' +
    '<button class="del-btn-confirm">确认删除</button>' +
    '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  var close = function () {
    overlay.classList.remove('active');
    setTimeout(function () {
      overlay.remove();
    }, 300);
  };
  overlay.querySelector('.del-btn-cancel').onclick = close;
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) close();
  });

  var confirmBtn = overlay.querySelector('.del-btn-confirm');
  confirmBtn.onclick = function () {
    confirmBtn.disabled = true;
    confirmBtn.textContent = '删除中...';
    api('my-plan-delete', { planId: planId })
      .then(function () {
        close();
        onSuccess();
      })
      .catch(function (e) {
        var body = overlay.querySelector('.del-modal-body');
        var errEl = body.querySelector('.del-err');
        if (!errEl) {
          errEl = document.createElement('p');
          errEl.className = 'del-err';
          body.appendChild(errEl);
        }
        errEl.textContent = '删除失败: ' + (e && e.message);
        setTimeout(function () {
          confirmBtn.disabled = false;
          confirmBtn.textContent = '确认删除';
        }, 2500);
      });
  };
}

// ═══ 我的方案 — 赔率变动异步刷新 ═══
function refreshMyPlanDelta(plans) {
  if (!plans || plans.length === 0) return;

  // 收集所有未开赛方案的 matchIds
  var pendingMatchIds = [];
  plans.forEach(function (p) {
    if (p.isWon === true || p.isWon === false) return; // 已开奖跳过
    var matches = p.matches || [];
    matches.forEach(function (m) {
      if (m.matchId && pendingMatchIds.indexOf(m.matchId) === -1) {
        pendingMatchIds.push(m.matchId);
      }
    });
  });
  if (pendingMatchIds.length === 0) return;

  // 批量获取最新赔率变动
  api('batch-match-odds', { matchIds: pendingMatchIds })
    .then(function (oddsMap) {
      if (!oddsMap) return;
      // 更新每张方案卡片中对应比赛的 odds-col 显示
      plans.forEach(function (p) {
        var card = document.getElementById('upcard-' + p.id);
        if (!card) return;
        var matches = p.matches || [];
        var rows = card.querySelectorAll('.plan-match-table tbody tr');
        matches.forEach(function (m, idx) {
          var oData = oddsMap[m.matchId];
          if (!oData || !oData.oddsDelta) return;
          var deltaArrow = '';
          var dirKey = (m.playType || 'spf') + '.' + (m.direction || m.oddsName || '');
          // RQSPF direction mapping
          var fieldName = m.direction || m.oddsName || '';
          if (m.playType === 'rqspf' && fieldName.indexOf('让') === 0) fieldName = fieldName.replace('让', '');
          var groupedKey = m.playType + 'Delta';
          var grouped = oData[groupedKey] || {};
          var deltaDir = grouped[fieldName] || null;
          if (!deltaDir) deltaDir = (oData.oddsDelta || {})[dirKey] || null;
          if (deltaDir === 'up') deltaArrow = ' <span style="color:#FF5B55;font-size:9px;">▲</span>';
          else if (deltaDir === 'down') deltaArrow = ' <span style="color:#34D399;font-size:9px;">▼</span>';
          if (deltaArrow && rows[idx]) {
            var oddsCell = rows[idx].querySelector('.odds-col');
            if (oddsCell && oddsCell.innerHTML.indexOf('▲') === -1 && oddsCell.innerHTML.indexOf('▼') === -1) {
              oddsCell.innerHTML += deltaArrow;
            }
          }
        });
      });
    })
    .catch(function () {
      /* 非关键 */
    });
}

// ═══ 我的方案 — 删除 ═══
window.deletePlanCard = function (planId) {
  var card = document.getElementById('upcard-' + planId);
  var nameEl = card ? card.querySelector('.plan-name') : null;
  var planName = nameEl ? nameEl.textContent.trim() : '';
  _confirmDelete(planId, planName, function () {
    loadMyPlanList();
  });
};

// ═══ 我的方案 — 分享截图 ═══
window.sharePlanCard = function (planId) {
  var card = document.getElementById('upcard-' + planId);
  if (!card) {
    _toast('方案卡片未找到', 'err');
    return;
  }

  var loadHtml2Canvas = window.html2canvas
    ? Promise.resolve(window.html2canvas)
    : new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
        script.onload = function () {
          resolve(window.html2canvas);
        };
        script.onerror = function () {
          reject(new Error('html2canvas 加载失败'));
        };
        document.head.appendChild(script);
      });

  _toast('正在生成分享图片...', 'info');

  loadHtml2Canvas
    .then(function (html2canvas) {
      var shareEl = _buildShareCard(card);
      document.body.appendChild(shareEl);

      // 等待图片加载后截图
      setTimeout(function () {
        html2canvas(shareEl, {
          scale: 1,
          useCORS: true,
          allowTaint: true,
          backgroundColor: null,
        })
          .then(function (canvas) {
            shareEl.remove();
            _showShareModal(planId, canvas, card);
          })
          .catch(function (e) {
            shareEl.remove();
            _toast('截图失败: ' + e.message, 'err');
          });
      }, 200);
    })
    .catch(function (e) {
      _toast('分享组件加载失败: ' + e.message, 'err');
    });
};

// ═══ 构建 750px 高品质分享卡片 DOM ═══
function _buildShareCard(cardEl) {
  // ── 提取数据 ──
  var name = '';
  var nameEl = cardEl.querySelector('.plan-name');
  if (nameEl) name = nameEl.textContent.trim();

  var date = '';
  var dateEl = cardEl.querySelector('.plan-pub-time');
  if (dateEl) {
    date = dateEl.textContent.trim();
    // 尝试提取 MM/DD
    var dm = date.match(/(\d{2}\/\d{2})/);
    if (dm) date = dm[1];
  }

  // 金额行
  var amountCols = cardEl.querySelectorAll('.plan-amount-col');
  var amountLabel = '',
    amountValue = '';
  var prizeLabel = '',
    prizeValue = '';
  var statusText = '未开奖';

  if (amountCols.length >= 1) {
    var al = amountCols[0].querySelector('.plan-amount-label');
    var av = amountCols[0].querySelector('.plan-amount-value');
    amountLabel = al ? al.textContent.trim() : '';
    amountValue = av ? av.textContent.trim().replace(/\s+/g, '') : '';
  }
  if (amountCols.length >= 2) {
    var pl = amountCols[1].querySelector('.plan-amount-label');
    var pv = amountCols[1].querySelector('.plan-amount-value');
    prizeLabel = pl ? pl.textContent.trim() : '';
    prizeValue = pv ? pv.textContent.trim().replace(/\s+/g, '') : '';
  }
  if (amountCols.length >= 3) {
    var sv = amountCols[2].querySelector('.plan-amount-value');
    if (sv) statusText = sv.textContent.trim();
  }

  // 信息行
  var infoRights = cardEl.querySelectorAll('.plan-info-right > div');
  var playType = infoRights[0] ? infoRights[0].textContent.trim() : '混合投注';
  var passType = infoRights[1] ? infoRights[1].textContent.trim() : '--';
  var betCount = infoRights[2] ? infoRights[2].textContent.trim() : '--';

  // 比赛行
  var matchRowsEl = cardEl.querySelectorAll('.plan-match-table tbody tr');
  var matchRows = '';
  matchRowsEl.forEach(function (row) {
    var cells = row.querySelectorAll('td');
    if (cells.length < 3) return;
    var numEl = cells[0].querySelector('.match-num-text');
    var timeEl = cells[0].querySelector('.match-time-sub');
    var num = numEl ? numEl.textContent.trim() : '';
    var matchTime = timeEl ? timeEl.textContent.trim() : '';
    var homeEl = cells[1].querySelector('.plan-team-home');
    var awayEl = cells[1].querySelector('.plan-team-away');
    var home = homeEl ? homeEl.textContent.trim() : '';
    var away = awayEl ? awayEl.textContent.trim() : '';
    var odds = cells[2].textContent.trim().replace(/\s+/g, ' ').substring(0, 48);
    matchRows +=
      '<div class="table-row">' +
      '<div class="issue"><div class="issue-num">' +
      num +
      '</div>' +
      (matchTime ? '<div class="issue-time">' + matchTime + '</div>' : '') +
      '</div>' +
      '<div class="vs"><div class="vs-team">' +
      home +
      '</div><span class="vs-mid">VS</span><div class="vs-team">' +
      away +
      '</div></div>' +
      '<div class="bet"><strong>' +
      odds +
      '</strong></div>' +
      '</div>';
  });

  // 金额值分离数字和单位
  var amtNum = amountValue,
    amtUnit = '元';
  var amtMatch = amountValue.match(/^([\d.]+)(.*)/);
  if (amtMatch) {
    amtNum = amtMatch[1];
    amtUnit = amtMatch[2] || '元';
  }

  var pNum = prizeValue,
    pUnit = '元';
  var pMatch = prizeValue.match(/^([+\-]?[\d.]+)(.*)/);
  if (pMatch) {
    pNum = pMatch[1];
    pUnit = pMatch[2] || '元';
  }

  var shareDate = String(date || '').replace(/\//g, '-');
  var statusCls = 'status-pending';
  if (statusText.indexOf('未中奖') !== -1) statusCls = 'status-lost';
  else if (statusText.indexOf('已中奖') !== -1) statusCls = 'status-won';

  var wrapper = document.createElement('div');

  wrapper.style.cssText = 'position:absolute;left:-9999px;top:0;width:750px;';
  wrapper.innerHTML =
    '<style>' +
    '*{margin:0;padding:0;box-sizing:border-box;}' +
    '.share-card{' +
    'width:750px;min-height:1680px;padding:42px 40px 72px;' +
    'background:radial-gradient(circle at 16% 0%,rgba(10,216,255,.18),transparent 26%),radial-gradient(circle at 88% 18%,rgba(0,120,255,.10),transparent 24%),linear-gradient(180deg,#021b31 0%,#031224 24%,#020c18 100%);' +
    'position:relative;overflow:hidden;color:#fff;' +
    'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif;' +
    '}' +
    '.share-card::before{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,234,255,.02),transparent 22%,transparent 78%,rgba(0,234,255,.02));pointer-events:none;}' +
    '.share-card::after{content:"";position:absolute;inset:24px;border:1px solid rgba(0,234,255,.12);border-radius:28px;box-shadow:inset 0 0 32px rgba(0,234,255,.06);pointer-events:none;}' +
    '.header{display:flex;justify-content:space-between;align-items:flex-start;position:relative;z-index:1;}' +
    '.header-left{display:flex;align-items:flex-start;gap:16px;}' +
    '.football-icon{width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,.18);color:#fff;font-size:34px;box-shadow:0 0 18px rgba(0,234,255,.16);}' +
    '.title-block{display:flex;flex-direction:column;gap:10px;}' +
    '.scheme-title{font-size:60px;line-height:1;font-weight:800;color:#fff;letter-spacing:2px;text-shadow:0 0 12px rgba(255,255,255,.08);}' +
    '.title-mark{display:flex;align-items:center;gap:8px;padding-left:2px;}' +
    '.title-mark b{display:block;width:92px;height:5px;border-radius:999px;background:linear-gradient(90deg,#21e8ff,#0fb3ff);box-shadow:0 0 14px rgba(33,232,255,.35);}' +
    '.title-mark i{display:block;width:54px;height:5px;border-radius:999px;background:repeating-linear-gradient(90deg,rgba(33,232,255,.92),rgba(33,232,255,.92) 6px,transparent 6px,transparent 11px);opacity:.92;}' +
    '.scheme-date{padding-top:4px;color:#c6d3de;font-size:28px;font-weight:500;letter-spacing:1px;}' +
    '.stat-panel{margin-top:34px;padding:28px 0 26px;border-top:1px solid rgba(0,234,255,.14);border-bottom:1px solid rgba(0,234,255,.16);display:flex;align-items:stretch;position:relative;z-index:1;}' +
    '.stat-item{flex:1;text-align:center;padding:0 18px;}' +
    '.stat-label{color:#a7b9c8;font-size:24px;line-height:1.2;}' +
    '.stat-value{margin-top:18px;color:#1ee9ff;font-size:58px;font-weight:800;letter-spacing:1px;text-shadow:0 0 14px rgba(30,233,255,.18);}' +
    '.stat-value span{font-size:26px;color:#dbe8f4;margin-left:4px;}' +
    '.stat-status{margin-top:18px;font-size:56px;font-weight:800;letter-spacing:1px;}' +
    '.stat-status.status-pending{color:#ffd126;text-shadow:0 0 12px rgba(255,209,38,.18);}' +
    '.stat-status.status-won{color:#ff9a4e;text-shadow:0 0 12px rgba(255,154,78,.16);}' +
    '.stat-status.status-lost{color:#74e3c8;text-shadow:0 0 12px rgba(116,227,200,.14);}' +
    '.stat-line{width:1px;background:linear-gradient(180deg,transparent,rgba(0,234,255,.38),transparent);}' +
    '.base-info{margin-top:34px;position:relative;z-index:1;}' +
    '.info-row{display:grid;grid-template-columns:50px 170px 1fr;align-items:center;height:96px;border-bottom:1px dashed rgba(0,234,255,.14);}' +
    '.info-row:last-child{border-bottom:none;}' +
    '.info-icon{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;border:1px solid rgba(0,234,255,.22);background:rgba(0,234,255,.05);color:#1ee9ff;font-size:22px;box-shadow:inset 0 0 12px rgba(0,234,255,.05);}' +
    '.label{color:#a7b9c8;font-size:28px;}' +
    '.value{color:#1ee9ff;font-size:34px;font-weight:700;letter-spacing:.5px;text-shadow:0 0 12px rgba(30,233,255,.14);}' +
    '.section-header{margin:34px 0 22px;display:flex;align-items:center;justify-content:center;gap:16px;position:relative;z-index:1;}' +
    '.section-line{width:74px;height:5px;border-radius:999px;background:linear-gradient(90deg,transparent,#1ee9ff 24%,#1ee9ff 76%,transparent);position:relative;}' +
    '.section-line::after{content:"";position:absolute;right:8px;top:0;width:24px;height:5px;border-radius:999px;background:repeating-linear-gradient(90deg,rgba(30,233,255,.9),rgba(30,233,255,.9) 5px,transparent 5px,transparent 9px);}' +
    '.section-text{font-size:34px;color:#fff;font-weight:700;letter-spacing:2px;}' +
    '.match-table{border:1px solid rgba(0,234,255,.16);border-radius:22px;background:linear-gradient(180deg,rgba(2,20,36,.72),rgba(1,12,24,.76));box-shadow:inset 0 0 22px rgba(0,234,255,.05);overflow:hidden;position:relative;z-index:1;}' +
    '.table-row{display:grid;grid-template-columns:150px 1fr 244px;min-height:152px;padding:0 8px;border-bottom:1px solid rgba(0,234,255,.10);}' +
    '.table-row:last-child{border-bottom:none;}' +
    '.issue,.vs,.bet{display:flex;align-items:center;justify-content:center;min-width:0;}' +
    '.issue{flex-direction:column;gap:8px;border-right:1px solid rgba(0,234,255,.10);}' +
    '.issue-num{color:#d7e3ee;font-size:22px;font-weight:700;}' +
    '.issue-time{color:#7d93a8;font-size:18px;font-weight:500;}' +
    '.vs{flex-direction:column;gap:8px;padding:20px 12px;}' +
    '.vs-team{color:#fff;font-size:26px;font-weight:700;line-height:1.25;text-align:center;word-break:break-all;}' +
    '.vs-mid{color:#8ea3b7;font-size:20px;font-weight:700;letter-spacing:1px;}' +
    '.bet{padding:20px 12px;border-left:1px solid rgba(0,234,255,.10);color:#fff;font-size:22px;font-weight:600;line-height:1.5;text-align:center;word-break:break-word;}' +
    '.bet strong{color:#1ee9ff;font-size:24px;text-shadow:0 0 10px rgba(30,233,255,.14);font-weight:800;}' +
    '.share-footer{margin-top:24px;display:flex;justify-content:center;position:relative;z-index:1;}' +
    '.share-footer span{width:160px;height:10px;border-radius:999px;border:1px solid rgba(0,234,255,.22);position:relative;display:block;}' +
    '.share-footer span::after{content:"";position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:34px;height:14px;border:1px solid rgba(0,234,255,.42);border-radius:999px;background:rgba(0,234,255,.10);box-shadow:0 0 14px rgba(0,234,255,.20);}' +
    '</style>' +
    '<div class="share-card">' +
    '<div class="header">' +
    '<div class="header-left">' +
    '<div class="football-icon">&#x26BD;</div>' +
    '<div class="title-block"><div class="scheme-title">' +
    name +
    '</div><div class="title-mark"><b></b><i></i></div></div>' +
    '</div>' +
    '<div class="scheme-date">' +
    shareDate +
    '</div>' +
    '</div>' +
    '<div class="stat-panel">' +
    '<div class="stat-item"><div class="stat-label">' +
    amountLabel +
    '</div><div class="stat-value">' +
    amtNum +
    '<span>' +
    amtUnit +
    '</span></div></div>' +
    '<div class="stat-line"></div>' +
    '<div class="stat-item"><div class="stat-label">' +
    prizeLabel +
    '</div><div class="stat-value">' +
    pNum +
    '<span>' +
    pUnit +
    '</span></div></div>' +
    '<div class="stat-line"></div>' +
    '<div class="stat-item"><div class="stat-label">方案状态</div><div class="stat-status ' +
    statusCls +
    '">' +
    statusText +
    '</div></div>' +
    '</div>' +
    '<div class="base-info">' +
    '<div class="info-row"><div class="info-icon">&#x2316;</div><div class="label">玩法</div><div class="value">' +
    playType +
    '</div></div>' +
    '<div class="info-row"><div class="info-icon">&#x25A3;</div><div class="label">场数/过关</div><div class="value">' +
    passType +
    '</div></div>' +
    '<div class="info-row"><div class="info-icon">&#x25CE;</div><div class="label">注数/倍数</div><div class="value">' +
    betCount +
    '</div></div>' +
    '</div>' +
    '<div class="section-header"><div class="section-line"></div><div class="section-text">赛事详情</div><div class="section-line"></div></div>' +
    '<div class="match-table">' +
    matchRows +
    '</div>' +
    '<div class="share-footer"><span></span></div>' +
    '</div>';

  return wrapper;
}

// ═══ 分享预览弹窗（通用） ═══
function _showShareModal(planId, canvas, cardEl) {
  var overlay = document.createElement('div');
  overlay.className = 'share-overlay active';
  var imgSrc = canvas.toDataURL('image/png');

  // 提取方案文字信息
  var infoLines = _extractPlanInfo(cardEl);

  overlay.innerHTML =
    '<div class="share-modal">' +
    '<div class="share-modal-header">' +
    '<span class="share-modal-title">&#x1F4E4; 分享方案</span>' +
    '<button class="share-modal-close">&times;</button>' +
    '</div>' +
    '<div class="share-modal-body">' +
    '<div class="share-img-wrap">' +
    '<img src="' +
    imgSrc +
    '" alt="方案截图" decoding="async" />' +
    '<div class="share-img-hint">&#x1F446; 长按图片可发送给微信好友</div>' +
    '</div>' +
    '</div>' +
    '<div class="share-modal-foot">' +
    '<button class="share-btn-copy">&#x1F4CB; 复制方案信息</button>' +
    '<button class="share-btn-save">&#x1F4BE; 保存图片</button>' +
    '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  var close = function () {
    overlay.classList.remove('active');
    setTimeout(function () {
      overlay.remove();
    }, 300);
  };
  overlay.querySelector('.share-modal-close').onclick = close;
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) close();
  });

  // 复制方案信息
  overlay.querySelector('.share-btn-copy').onclick = function () {
    navigator.clipboard
      .writeText(infoLines)
      .then(function () {
        var btn = overlay.querySelector('.share-btn-copy');
        btn.textContent = '\u2714 已复制';
        btn.classList.add('copied');
        setTimeout(function () {
          btn.textContent = '\uD83D\uDCCB 复制方案信息';
          btn.classList.remove('copied');
        }, 2000);
      })
      .catch(function () {
        var ta = document.createElement('textarea');
        ta.value = infoLines;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        var btn = overlay.querySelector('.share-btn-copy');
        btn.textContent = '\u2714 已复制';
        btn.classList.add('copied');
        setTimeout(function () {
          btn.textContent = '\uD83D\uDCCB 复制方案信息';
          btn.classList.remove('copied');
        }, 2000);
      });
  };

  // 保存图片
  overlay.querySelector('.share-btn-save').onclick = function () {
    var link = document.createElement('a');
    link.download = 'plan-' + planId + '.png';
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    _toast('图片已保存', 'ok');
  };
}

// ═══ 从方案卡片 DOM 提取文字信息 ═══
function _extractPlanInfo(cardEl) {
  var lines = [];
  var nameEl = cardEl.querySelector('.plan-name');
  if (nameEl) lines.push(nameEl.textContent.trim());
  lines.push('');

  // 比赛信息
  var rows = cardEl.querySelectorAll('.plan-match-table tbody tr');
  rows.forEach(function (row) {
    var cells = row.querySelectorAll('td');
    if (cells.length >= 3) {
      var num = cells[0].textContent.trim().replace(/\s+/g, ' ');
      var teams = cells[1].textContent.trim().replace(/\s+/g, ' ');
      var odds = cells[2].textContent.trim().replace(/\s+/g, ' ');
      if (num || teams) lines.push((num || '') + '  ' + teams + '  ' + (odds || ''));
    }
  });

  // 方案金额和奖金
  var amountCols = cardEl.querySelectorAll('.plan-amount-col');
  if (amountCols.length >= 2) {
    var amtLabel = amountCols[0].querySelector('.plan-amount-label');
    var amtVal = amountCols[0].querySelector('.plan-amount-value');
    var prizeLabel = amountCols[1].querySelector('.plan-amount-label');
    var prizeVal = amountCols[1].querySelector('.plan-amount-value');
    lines.push('');
    if (amtLabel && amtVal)
      lines.push((amtLabel.textContent.trim() + ': ' + amtVal.textContent.trim()).replace(/\s+/g, ' '));
    if (prizeLabel && prizeVal)
      lines.push((prizeLabel.textContent.trim() + ': ' + prizeVal.textContent.trim()).replace(/\s+/g, ' '));
  }

  return lines.join('\n');
}

// ═══ Toast 轻提示 ═══
function _toast(msg, type) {
  var el = document.getElementById('shareToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'shareToast';
    el.style.cssText =
      'position:fixed;top:60px;left:50%;transform:translateX(-50%);z-index:99999;padding:10px 24px;border-radius:20px;font-size:13px;font-weight:600;pointer-events:none;transition:opacity 0.3s;opacity:0;';
    document.body.appendChild(el);
  }
  if (type === 'err') {
    el.style.background = 'rgba(239,68,68,0.9)';
    el.style.color = '#fff';
  } else if (type === 'ok') {
    el.style.background = 'rgba(34,197,94,0.9)';
    el.style.color = '#fff';
  } else {
    el.style.background = 'rgba(0,0,0,0.8)';
    el.style.color = '#fff';
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._timer);
  el._timer = setTimeout(function () {
    el.style.opacity = '0';
  }, 2000);
}

// ========== 比分方案 ==========
export function loadScorePlanList() {
  var el = document.getElementById('planList');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载单关比分方案中...</div>';

  var params;
  if (state.planDateExplicit) {
    params = { date: state.planDate };
  } else if (state.planDateOffset === 0) {
    params = { date: state.planDate };
  } else {
    params = { date: state.planDate };
  }

  // ★ P1: sessionStorage 缓存命中
  var cacheKey = 'score-plan-list:' + state.planDate;
  var cached = getCache(cacheKey);
  if (cached) {
    el.innerHTML = cached;
    return;
  }

  api('score-plan-list', params)
    .then(function (data) {
      if (data.date && data.date !== state.planDate && !state.planDateExplicit) {
        state.setPlanDate(data.date);
        var planEl = document.getElementById('planDateCurrent');
        if (planEl) {
          var mmdd = data.date.slice(5).replace('-', '/');
          planEl.textContent = mmdd + ' ' + WEEK_NAMES[new Date(data.date).getDay()];
        }
      }
      var plans = data.plans || [];
      var notice = data.notice || '';
      if (plans.length === 0) {
        var now = new Date();
        var todayStr =
          now.getFullYear() +
          '-' +
          String(now.getMonth() + 1).padStart(2, '0') +
          '-' +
          String(now.getDate()).padStart(2, '0');
        // 今天的方案为空 → 回退并切到专家标签
        if (state.planDate === todayStr) {
          var d2 = new Date();
          d2.setDate(d2.getDate() + state.planDateOffset - 1);
          var prevDateStr =
            d2.getFullYear() +
            '-' +
            String(d2.getMonth() + 1).padStart(2, '0') +
            '-' +
            String(d2.getDate()).padStart(2, '0');
          if (prevDateStr >= MIN_PLAN_DATE) {
            state.setPlanDateOffset(state.planDateOffset - 1);
            state.setPlanTab('expert');
            document.querySelectorAll('#planTabBar .filter-tag').forEach(function (btn) {
              btn.classList.toggle('active', btn.getAttribute('data-tab') === 'expert');
            });
            updatePlanDateBar();
            loadPlanList();
            return;
          }
        }
        if (notice) {
          el.innerHTML =
            '<div class="plan-notice"><span class="notice-icon"><img src="/assets/expressionless-face.svg" width="32" height="32" alt="" decoding="async"/></span>' +
            notice +
            '</div>';
        } else {
          el.innerHTML =
            '<div class="plan-notice"><span class="notice-icon">📊</span>今日暂无符合条件的单关比分方案</div>';
        }
        return;
      }

      var html = plans
        .map(function (p, i) {
          var scores = p.selectedScores || [];
          var isWon = p.isScoreWon || false;
          var isLose = p.isScoreLose || false;
          var cutoffDisplay = '';
          if (p.startTime) {
            var stParts = p.startTime.match(/(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
            if (stParts) {
              var stMonth = parseInt(stParts[1]) - 1,
                stDay = parseInt(stParts[2]),
                stHour = parseInt(stParts[3]),
                stMin = parseInt(stParts[4]);
              var pYear = parseInt(state.planDate.slice(0, 4));
              var kickoff = new Date(pYear, stMonth, stDay, stHour, stMin);
              if (!isNaN(kickoff.getTime())) {
                var mp = state.planDate.split('-');
                var matchDateOnly = new Date(parseInt(mp[0]), parseInt(mp[1]) - 1, parseInt(mp[2]));
                var kickoffDateOnly = new Date(kickoff.getFullYear(), kickoff.getMonth(), kickoff.getDate());
                var isCrossMidnight = kickoffDateOnly > matchDateOnly;
                var cutoff;
                if (isCrossMidnight) {
                  var matchDow = matchDateOnly.getDay();
                  if (matchDow >= 1 && matchDow <= 5)
                    cutoff = new Date(parseInt(mp[0]), parseInt(mp[1]) - 1, parseInt(mp[2]), 21, 30);
                  else cutoff = new Date(parseInt(mp[0]), parseInt(mp[1]) - 1, parseInt(mp[2]), 22, 30);
                } else {
                  cutoff = new Date(kickoff.getTime() - 30 * 60 * 1000);
                  var dow = kickoff.getDay();
                  if (dow >= 1 && dow <= 5 && stHour >= 22) cutoff = new Date(pYear, stMonth, stDay, 21, 30);
                  else if ((dow === 0 || dow === 6) && stHour >= 23) cutoff = new Date(pYear, stMonth, stDay, 22, 30);
                }
                var pad2 = function (n) {
                  return String(n).padStart(2, '0');
                };
                cutoffDisplay =
                  '截单时间：' +
                  pad2(cutoff.getMonth() + 1) +
                  '/' +
                  pad2(cutoff.getDate()) +
                  ' ' +
                  pad2(cutoff.getHours()) +
                  ':' +
                  pad2(cutoff.getMinutes());
              }
            }
          }

          var amountVal = (p.amount || 1000).toFixed(0);
          var isWon = p.isScoreWon || false;
          var isLose = p.isScoreLose || false;
          var prizeNum2 = isWon ? p.winningPrize || 0 : isLose ? 0 : p.maxPrize || 0;
          var prizeVal = prizeNum2 > 0 ? prizeNum2.toFixed(0) : isWon ? '--' : '0';
          var prizeLabel = isWon || isLose ? '中奖金额' : '预计最高奖金';
          var statusText = isWon ? '已中奖' : isLose ? '未中奖' : '未开奖';

          // 构建比分标签 + 资金分配（按行显示）
          var scoreRows = '';
          var matchTimeShort = '';
          if (p.startTime) {
            var tm = p.startTime.match(/(\d{2}:\d{2})/);
            if (tm) matchTimeShort = tm[1];
          }
          for (var si = 0; si < scores.length; si++) {
            var s = scores[si];
            scoreRows +=
              '<tr>' +
              '<td class="match-info-col">' +
              '<div class="match-num-text">' +
              (si === 0 ? p.matchNum || '' : '') +
              '</div>' +
              (si === 0 && matchTimeShort ? '<div class="match-time-sub">' + matchTimeShort + '</div>' : '') +
              '</td>' +
              '<td class="team-col">' +
              (si === 0 ? renderMatchTeams(p) : '') +
              '</td>' +
              '<td class="odds-col">' +
              '<span class="plan-score-tag">' +
              s.score +
              ' (' +
              s.odds.toFixed(2) +
              ')</span>' +
              '</td>' +
              '<td class="allocation-col">' +
              '<span class="plan-alloc-val">' +
              (s.allocation || 0) +
              '</span><span class="plan-alloc-unit">元</span>' +
              '</td>' +
              '</tr>';
          }

          var scoreCardId = 'score-' + i;
          return (
            '<div class="plan-card score-plan" id="upcard-' +
            scoreCardId +
            '">' +
            '<div class="plan-card-head">' +
            '<div class="plan-left">' +
            '<span class="plan-soccer-icon"><img src="/assets/plan_icon.png?v=1" alt="" decoding="async"/></span>' +
            '<span class="plan-name" style="color: var(--amber);">' +
            (p.planName || '单关比分方案') +
            '</span>' +
            '</div>' +
            '<span class="plan-pub-time">' +
            cutoffDisplay +
            '</span>' +
            (function () {
              /* eslint-disable no-undef */
              var matchIds = matches.map(function (m) {
                return m.matchId;
              });
              var best = null;
              matchIds.forEach(function (id) {
                var c = consensusMap[id];
                if (
                  c &&
                  (!best ||
                    (c.consensus === 'strong' && best.consensus !== 'strong') ||
                    (c.consensus === 'weak' && best.consensus === 'neutral'))
                )
                  best = c;
              });
              /* eslint-enable no-undef */
              if (!best) return '';
              var cls = best.consensus === 'strong' ? 'strong' : best.consensus === 'weak' ? 'weak' : 'neutral';
              var txt =
                best.consensus === 'strong'
                  ? '共识' + best.agreeCount + '/' + best.totalCount
                  : best.consensus === 'weak'
                    ? '弱共识'
                    : '';
              return (
                '<span class="consensus-badge ' + cls + '" style="font-size:10px;margin-left:6px">' + txt + '</span>'
              );
            })() +
            '</div>' +
            '<div class="plan-amount-row">' +
            '<div class="plan-amount-col">' +
            '<div class="plan-amount-label">方案金额</div>' +
            '<div class="plan-amount-value">' +
            amountVal +
            '<span class="unit">元</span></div>' +
            '</div>' +
            '<div class="plan-amount-col">' +
            '<div class="plan-amount-label">' +
            prizeLabel +
            '</div>' +
            '<div class="plan-amount-value" style="color: ' +
            (isWon ? 'var(--red)' : 'var(--amber)') +
            ';">' +
            prizeVal +
            '<span class="unit">元</span></div>' +
            '</div>' +
            '<div class="plan-amount-col">' +
            '<div class="plan-amount-label">方案状态</div>' +
            '<div class="plan-amount-value">' +
            statusText +
            '</div>' +
            '</div>' +
            '</div>' +
            '<div class="plan-divider"></div>' +
            '<div class="plan-info-grid">' +
            '<div class="plan-info-left">' +
            '<div>玩法</div>' +
            '<div>过关</div>' +
            '<div>赔率组合</div>' +
            '</div>' +
            '<div class="plan-info-right">' +
            '<div>' +
            (p.playType || '单场比分') +
            '</div>' +
            '<div>' +
            (p.passType || '比分单关') +
            '</div>' +
            '<div class="plan-odds-combo">' +
            (p.oddsDisplay || '') +
            '</div>' +
            '</div>' +
            (isWon
              ? '<div class="plan-win-stamp"><svg width="38" height="38" viewBox="0 0 38 38"><circle cx="19" cy="19" r="17" fill="none" stroke="#EF4444" stroke-width="2"/><text x="19" y="25" text-anchor="middle" font-size="18" font-weight="900" fill="#EF4444" transform="rotate(-10,19,19)">中</text></svg></div>'
              : '') +
            (isLose
              ? '<div class="plan-lose-stamp"><svg width="38" height="38" viewBox="0 0 38 38"><circle cx="19" cy="19" r="17" fill="none" stroke="#9AA6B2" stroke-width="2"/><text x="19" y="25" text-anchor="middle" font-size="16" font-weight="900" fill="#9AA6B2" transform="rotate(-10,19,19)">未中</text></svg></div>'
              : '') +
            '</div>' +
            '<div class="plan-match-section">' +
            '<table class="plan-match-table score-table">' +
            '<thead><tr><th>场次</th><th>对阵</th><th>方向(赔率)</th><th>资金分配</th></tr></thead>' +
            '<tbody>' +
            scoreRows +
            '</tbody>' +
            '</table>' +
            '</div>' +
            '<div class="plan-score-meta">' +
            '<span>大球率 ' +
            (p.bigBallRatio || '--') +
            '%</span>' +
            '<span>进攻优势 ' +
            (p.attackAdvantage || '--') +
            '</span>' +
            '<span>进球区间 ' +
            (p.goalRange || '--') +
            '</span>' +
            '<span>强队 ' +
            (p.strongSide === 'home' ? '主队' : '客队') +
            '</span>' +
            '</div>' +
            '<div class="mp-actions">' +
            '<button class="mp-share-btn" onclick="sharePlanCard(\'' +
            scoreCardId +
            '\')">📤 分享</button>' +
            '</div>' +
            '</div>'
          );
        })
        .join('');
      el.innerHTML = html;
      setCache('score-plan-list:' + state.planDate, html);
    })
    .catch(function (e) {
      el.innerHTML = '<div style="text-align:center;padding:80px 0;color:var(--text3);">' + e.message + '</div>';
    });
}

// ========== 量化方案 ==========
export function loadQuantPlanList() {
  var el = document.getElementById('planList');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载量化博冷方案中...</div>';

  var params;
  if (state.planDateExplicit) {
    params = { date: state.planDate };
  } else if (state.planDateOffset === 0) {
    params = { date: state.planDate };
  } else {
    params = { date: state.planDate };
  }

  // ★ P1: sessionStorage 缓存命中
  var cacheKey = 'quant-plan-list:' + state.planDate;
  var cached = getCache(cacheKey);
  if (cached) {
    el.innerHTML = cached;
    return;
  }

  api('quant-plan-list', params)
    .then(function (data) {
      if (data.date && data.date !== state.planDate && !state.planDateExplicit) {
        state.setPlanDate(data.date);
        var planEl = document.getElementById('planDateCurrent');
        if (planEl) {
          var mmdd = data.date.slice(5).replace('-', '/');
          planEl.textContent = mmdd + ' ' + WEEK_NAMES[new Date(data.date).getDay()];
        }
      }
      var plans = data.plans || [];
      var notice = data.notice || '';
      if (plans.length === 0) {
        var now = new Date();
        var todayStr =
          now.getFullYear() +
          '-' +
          String(now.getMonth() + 1).padStart(2, '0') +
          '-' +
          String(now.getDate()).padStart(2, '0');
        // 今天的方案为空 → 回退并切到专家标签
        if (state.planDate === todayStr) {
          var d2 = new Date();
          d2.setDate(d2.getDate() + state.planDateOffset - 1);
          var prevDateStr =
            d2.getFullYear() +
            '-' +
            String(d2.getMonth() + 1).padStart(2, '0') +
            '-' +
            String(d2.getDate()).padStart(2, '0');
          if (prevDateStr >= MIN_PLAN_DATE) {
            state.setPlanDateOffset(state.planDateOffset - 1);
            state.setPlanTab('expert');
            document.querySelectorAll('#planTabBar .filter-tag').forEach(function (btn) {
              btn.classList.toggle('active', btn.getAttribute('data-tab') === 'expert');
            });
            updatePlanDateBar();
            loadPlanList();
            return;
          }
        }
        if (notice) {
          el.innerHTML =
            '<div class="plan-notice"><span class="notice-icon"><img src="/assets/expressionless-face.svg" width="32" height="32" alt="" decoding="async"/></span>' +
            notice +
            '</div>';
        } else {
          el.innerHTML =
            '<div class="plan-notice"><span class="notice-icon">📊</span>今日暂无符合条件的量化博冷方案</div>';
        }
        return;
      }

      var html = plans
        .map(function (p, i) {
          var matches = p.matches || [];
          // ★ 中奖判定逻辑（复用专家方案规则）
          var isWon = false,
            isLose = false;
          var allWon = matches.length > 0;
          var anyLose = false,
            anyUndetermined = false;
          for (var mi2 = 0; mi2 < matches.length; mi2++) {
            if (!matches[mi2].isMatchWon) allWon = false;
            if (matches[mi2].isMatchLose) anyLose = true;
            if (!matches[mi2].isMatchWon && !matches[mi2].isMatchLose) anyUndetermined = true;
          }
          isWon = allWon;
          isLose = anyLose && !isWon;
          if (anyUndetermined) {
            isWon = false;
            isLose = false;
          }
          // 截单时间计算（复用 expert plan 逻辑）
          var cutoffDisplay = '';
          if (matches.length > 0 && matches[0].startTime) {
            var stParts = matches[0].startTime.match(/(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
            if (stParts) {
              var stMonth = parseInt(stParts[1]) - 1,
                stDay = parseInt(stParts[2]),
                stHour = parseInt(stParts[3]),
                stMin = parseInt(stParts[4]);
              var pYear = parseInt(state.planDate.slice(0, 4));
              var kickoff = new Date(pYear, stMonth, stDay, stHour, stMin);
              if (!isNaN(kickoff.getTime())) {
                var mp = state.planDate.split('-');
                var matchDateOnly = new Date(parseInt(mp[0]), parseInt(mp[1]) - 1, parseInt(mp[2]));
                var kickoffDateOnly = new Date(kickoff.getFullYear(), kickoff.getMonth(), kickoff.getDate());
                var isCrossMidnight = kickoffDateOnly > matchDateOnly;
                var cutoff;
                if (isCrossMidnight) {
                  var matchDow = matchDateOnly.getDay();
                  if (matchDow >= 1 && matchDow <= 5)
                    cutoff = new Date(parseInt(mp[0]), parseInt(mp[1]) - 1, parseInt(mp[2]), 21, 30);
                  else cutoff = new Date(parseInt(mp[0]), parseInt(mp[1]) - 1, parseInt(mp[2]), 22, 30);
                } else {
                  cutoff = new Date(kickoff.getTime() - 30 * 60 * 1000);
                  var dow = kickoff.getDay();
                  if (dow >= 1 && dow <= 5 && stHour >= 22) cutoff = new Date(pYear, stMonth, stDay, 21, 30);
                  else if ((dow === 0 || dow === 6) && stHour >= 23) cutoff = new Date(pYear, stMonth, stDay, 22, 30);
                }
                var pad2 = function (n) {
                  return String(n).padStart(2, '0');
                };
                cutoffDisplay =
                  '截单时间：' +
                  pad2(cutoff.getMonth() + 1) +
                  '/' +
                  pad2(cutoff.getDate()) +
                  ' ' +
                  pad2(cutoff.getHours()) +
                  ':' +
                  pad2(cutoff.getMinutes());
              }
            }
          }

          var planName = p.planName || '量化博冷方案 ' + (i + 1);
          var amountVal = (p.amount || 1000).toFixed(0);
          // ★ 不覆盖 isWon/isLose — 上面已从 matches[].isMatchWon/isMatchLose 正确计算
          var prizeNum3 = isWon ? p.winningPrize || p.maxPrize || 0 : isLose ? 0 : p.maxPrize || 0;
          var prizeVal = prizeNum3 > 0 ? prizeNum3.toFixed(0) : isWon || isLose ? '0' : '0';
          var prizeLabel = isWon || isLose ? '中奖金额' : '预计最高奖金';
          var statusText = isWon ? '已中奖' : isLose ? '未中奖' : '未开奖';

          // 构建比赛表格行
          var matchRows = '';
          for (var mi = 0; mi < matches.length; mi++) {
            var m = matches[mi];
            var numText = m.matchNum || '';
            var matchDateShort = '',
              matchTime = '';
            if (m.startTime) {
              var tm = m.startTime.match(/(\d{2}:\d{2})/);
              if (tm) matchTime = tm[1];
              var dm = m.startTime.match(/(\d{2})\/(\d{2})/) || m.startTime.match(/(\d{2})-(\d{2})/);
              if (dm) matchDateShort = dm[1] + '/' + dm[2];
            }
            var timeDisp = matchDateShort || matchTime ? (matchDateShort + ' ' + matchTime).trim() : '';

            // 方向+赔率展示（带命中颜色标记）
            var dir = m.direction || '';
            var oddsObj = m.odds || {};
            var oddsVal = '';
            if (oddsObj.spf) {
              var dLower = dir.toLowerCase();
              if (dLower === '胜' || dLower.indexOf('胜') === 0) oddsVal = oddsObj.spf.home;
              else if (dLower === '平' || dLower.indexOf('平') === 0) oddsVal = oddsObj.spf.draw;
              else if (dLower === '负' || dLower.indexOf('负') === 0) oddsVal = oddsObj.spf.away;
              else if (dLower === '让胜') oddsVal = oddsObj.rqspf ? oddsObj.rqspf.home : '';
              else if (dLower === '让平') oddsVal = oddsObj.rqspf ? oddsObj.rqspf.draw : '';
              else if (dLower === '让负') oddsVal = oddsObj.rqspf ? oddsObj.rqspf.away : '';
            }
            // 根据 subResults 判定命中颜色
            var subR = null;
            var subResults = m.subResults || [];
            for (var sii = 0; sii < subResults.length; sii++) {
              if (subResults[sii].direction === dir) {
                subR = subResults[sii];
                break;
              }
            }
            var matchColor = '#fff';
            if (subR && subR.result !== null && subR.result !== undefined) {
              matchColor = subR.result === 1 ? '#EF4444' : '#22C55E';
            }
            var oddsDisplay = oddsVal
              ? '<span style="color:' + matchColor + '">' + dir + '(' + oddsVal + ')</span>'
              : '<span style="color:' + matchColor + '">' + dir + '</span>';

            matchRows +=
              '<tr>' +
              '<td class="match-info-col">' +
              '<div class="match-num-text">' +
              numText +
              '</div>' +
              (timeDisp ? '<div class="match-time-sub">' + timeDisp + '</div>' : '') +
              '</td>' +
              '<td class="team-col">' +
              renderMatchTeams(m) +
              '</td>' +
              '<td class="odds-col">' +
              oddsDisplay +
              '</td>' +
              '</tr>';
          }

          var quantCardId = 'quant-' + i;
          return (
            '<div class="plan-card quant-plan" id="upcard-' +
            quantCardId +
            '">' +
            '<div class="plan-card-head">' +
            '<div class="plan-left">' +
            '<span class="plan-soccer-icon"><img src="/assets/plan_icon.png?v=1" alt="" decoding="async"/></span>' +
            '<span class="plan-name" style="color: var(--purple);">' +
            planName +
            '</span>' +
            '</div>' +
            '<span class="plan-pub-time">' +
            cutoffDisplay +
            '</span>' +
            (function () {
              /* eslint-disable no-undef */
              var matchIds = matches.map(function (m) {
                return m.matchId;
              });
              var best = null;
              matchIds.forEach(function (id) {
                var c = consensusMap[id];
                if (
                  c &&
                  (!best ||
                    (c.consensus === 'strong' && best.consensus !== 'strong') ||
                    (c.consensus === 'weak' && best.consensus === 'neutral'))
                )
                  best = c;
              });
              /* eslint-enable no-undef */
              if (!best) return '';
              var cls = best.consensus === 'strong' ? 'strong' : best.consensus === 'weak' ? 'weak' : 'neutral';
              var txt =
                best.consensus === 'strong'
                  ? '共识' + best.agreeCount + '/' + best.totalCount
                  : best.consensus === 'weak'
                    ? '弱共识'
                    : '';
              return (
                '<span class="consensus-badge ' + cls + '" style="font-size:10px;margin-left:6px">' + txt + '</span>'
              );
            })() +
            '</div>' +
            '<div class="plan-amount-row">' +
            '<div class="plan-amount-col">' +
            '<div class="plan-amount-label">方案金额</div>' +
            '<div class="plan-amount-value">' +
            amountVal +
            '<span class="unit">元</span></div>' +
            '</div>' +
            '<div class="plan-amount-col">' +
            '<div class="plan-amount-label">' +
            prizeLabel +
            '</div>' +
            '<div class="plan-amount-value" style="color: var(--purple);">' +
            prizeVal +
            '<span class="unit">元</span></div>' +
            '</div>' +
            '<div class="plan-amount-col">' +
            '<div class="plan-amount-label">方案状态</div>' +
            '<div class="plan-amount-value">' +
            statusText +
            '</div>' +
            '</div>' +
            '</div>' +
            '<div class="plan-divider"></div>' +
            '<div class="plan-info-grid">' +
            '<div class="plan-info-left">' +
            '<div>玩法</div>' +
            '<div>过关</div>' +
            '<div>赔率组合</div>' +
            '</div>' +
            '<div class="plan-info-right">' +
            '<div>' +
            (p.playType || '混合投注（搏冷）') +
            '</div>' +
            '<div>' +
            (p.passType || '2串1') +
            '</div>' +
            '<div class="plan-odds-combo">' +
            (p.oddsDisplay || '') +
            '</div>' +
            '</div>' +
            (isWon
              ? '<div class="plan-win-stamp"><svg width="38" height="38" viewBox="0 0 38 38"><circle cx="19" cy="19" r="17" fill="none" stroke="#EF4444" stroke-width="2"/><text x="19" y="25" text-anchor="middle" font-size="18" font-weight="900" fill="#EF4444" transform="rotate(-10,19,19)">中</text></svg></div>'
              : '') +
            (isLose
              ? '<div class="plan-lose-stamp"><svg width="38" height="38" viewBox="0 0 38 38"><circle cx="19" cy="19" r="17" fill="none" stroke="#9AA6B2" stroke-width="2"/><text x="19" y="25" text-anchor="middle" font-size="16" font-weight="900" fill="#9AA6B2" transform="rotate(-10,19,19)">未中</text></svg></div>'
              : '') +
            '</div>' +
            '<div class="plan-match-section">' +
            '<table class="plan-match-table">' +
            '<thead><tr><th>场次</th><th>对阵</th><th>方向(赔率)</th></tr></thead>' +
            '<tbody>' +
            matchRows +
            '</tbody>' +
            '</table>' +
            '</div>' +
            '<div class="plan-score-meta">' +
            '<span>🧊冷热指数 ' +
            (p.coldIndex || '--') +
            '</span>' +
            '<span>📊综合评分 ' +
            (p.compositeScore || '--') +
            '</span>' +
            '<span>' +
            (p.consensus || '--') +
            '</span>' +
            '</div>' +
            '<div class="mp-actions">' +
            '<button class="mp-share-btn" onclick="sharePlanCard(\'' +
            quantCardId +
            '\')">📤 分享</button>' +
            '</div>' +
            '</div>'
          );
        })
        .join('');
      el.innerHTML = html;
      setCache('quant-plan-list:' + state.planDate, html);
    })
    .catch(function (e) {
      el.innerHTML = '<div style="text-align:center;padding:80px 0;color:var(--text3);">' + e.message + '</div>';
    });
}

// =============================================================
// * 蓝图：共识过滤控件 + 状态  (方案收入筛选项风格)
// =============================================================
function buildConsensusFilterBar(consensusCount, active) {
  var items = [
    { id: 'all', label: '全部' },
    { id: 'strong', label: '强共识' },
    { id: 'weak', label: '弱共识' },
  ];
  var html = '<div class="filter-section-card" style="margin-bottom:14px;padding:16px 18px">';
  html += '<div class="filter-head" style="margin-bottom:12px;font-size:var(--fs-md)">共识过滤';
  if (consensusCount > 0) {
    html +=
      '<span style="font-size:var(--fs-xs);color:var(--text3);margin-left:6px;font-weight:400">（共' +
      consensusCount +
      '场共识比赛）</span>';
  }
  html += '</div>';
  html += '<div style="display:flex;gap:8px">';
  items.forEach(function (t) {
    var isActive = active === t.id;
    var btnStyle = isActive
      ? 'background:var(--cyan);color:#001018;font-weight:600;box-shadow:0 0 10px rgba(24,224,224,0.25)'
      : 'background:rgba(24,224,224,0.08);color:var(--text2)';
    html +=
      '<div class="consensus-filter-btn" data-level="' +
      t.id +
      '" onclick="window.switchConsensusFilter(\'' +
      t.id +
      '\')" style="flex:1;text-align:center;padding:9px 0;border-radius:10px;font-size:var(--fs-sm);cursor:pointer;transition:all 0.25s;border:1px solid ' +
      (isActive ? 'rgba(24,224,224,0.4)' : 'rgba(255,255,255,0.06)') +
      ';' +
      btnStyle +
      '">' +
      t.label +
      '</div>';
  });
  html += '</div>';
  html += '</div>';
  return html;
}
if (!window._planConsensusFilter) window._planConsensusFilter = 'all';
window.switchConsensusFilter = function (level) {
  window._planConsensusFilter = level;
  loadPlanList();
};
