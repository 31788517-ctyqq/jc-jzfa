import { api } from '../api.js';
import { WEEK_NAMES, MIN_PLAN_DATE } from '../utils.js';
import * as state from '../state.js';

export function updatePlanDateBar() {
  var d = new Date();
  d.setDate(d.getDate() + state.planDateOffset);
  state.setPlanDate(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
  var el = document.getElementById('planDateCurrent');
  if (!el) return;
  var today = new Date();
  var todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  var prefix = state.planDate === todayStr ? '今天 ' : '';
  var mmdd = state.planDate.slice(5).replace('-', '/');
  var week = WEEK_NAMES[new Date(state.planDate).getDay()];
  el.textContent = prefix + mmdd + ' ' + week;
}

export function shiftPlanDate(delta) {
  var newOffset = state.planDateOffset + delta;
  var d = new Date();
  d.setDate(d.getDate() + newOffset);
  var newDate = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  if (newDate < MIN_PLAN_DATE) return;
  state.setPlanDateOffset(newOffset);
  updatePlanDateBar();
  loadPlanList();
}

export function goPlanToday() {
  state.setPlanDateOffset(0);
  updatePlanDateBar();
  loadPlanList();
}

export function loadPlanList() {
  var el = document.getElementById('planList');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载方案中...</div>';

  // 初始加载时不传日期，让服务器自动选择最新数据日
  var params = state.planDateOffset === 0 ? {} : { date: state.planDate };
  api('plan-list', params).then(function (data) {
    // 用服务器返回的实际日期更新显示（直接改DOM避免updatePlanDateBar重置）
    if (data.date && data.date !== state.planDate) {
      state.setPlanDate(data.date);
      var planEl = document.getElementById('planDateCurrent');
      if (planEl) {
        var mmdd = data.date.slice(5).replace('-', '/');
        var week = WEEK_NAMES[new Date(data.date).getDay()];
        planEl.textContent = mmdd + ' ' + week;
      }
    }
    var plans = data.plans || [];
    if (plans.length === 0) {
      var now = new Date();
      var todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      if (state.planDate === todayStr) {
        var d2 = new Date();
        d2.setDate(d2.getDate() + state.planDateOffset - 1);
        var prevDateStr = d2.getFullYear() + '-' + String(d2.getMonth() + 1).padStart(2, '0') + '-' + String(d2.getDate()).padStart(2, '0');
        if (prevDateStr >= MIN_PLAN_DATE) {
          state.setPlanDateOffset(state.planDateOffset - 1);
          updatePlanDateBar();
          loadPlanList();
          return;
        }
      }
      el.innerHTML = '<div style="text-align:center;padding:80px 0;color:var(--text3);font-size:14px;">当日暂无竞彩方案</div>';
      return;
    }

    el.innerHTML = plans.map(function (p, i) {
      var matches = p.matches || [];
      var isWon = false, isLose = false;
      if (p.passType === '混合过关') {
        var hitCount = 0, loseCount = 0, undetermined = false;
        for (var mi = 0; mi < matches.length; mi++) {
          if (matches[mi].isMatchWon) hitCount++;
          else if (matches[mi].isMatchLose) loseCount++;
          else undetermined = true;
        }
        if (!undetermined) {
          isWon = hitCount >= 2;
          isLose = !isWon;
        }
      } else {
        var allWon = matches.length > 0;
        var anyLose = false, anyUndetermined = false;
        for (var mi2 = 0; mi2 < matches.length; mi2++) {
          if (!matches[mi2].isMatchWon) allWon = false;
          if (matches[mi2].isMatchLose) anyLose = true;
          if (!matches[mi2].isMatchWon && !matches[mi2].isMatchLose) anyUndetermined = true;
        }
        isWon = allWon;
        isLose = anyLose && !isWon;
        if (anyUndetermined) { isWon = false; isLose = false; }
      }

      var planName = p.planName || ('方案' + (i + 1));
      var amountVal = (p.amount || 1000).toFixed(0);
      var prizeVal = (p.maxPrize || 0).toFixed(0);
      var prizeLabel = isWon ? '中奖金额' : (isLose ? '预计奖金' : '预计最高奖金');

      if (p.passType === '混合过关' && isWon) {
        var hitOddsArr = [];
        for (var mi3 = 0; mi3 < matches.length; mi3++) {
          if (matches[mi3].isMatchWon) {
            var eo = matches[mi3].effectiveOdds;
            if (!eo) {
              var od = matches[mi3].odds || {};
              if (od.rqspf && od.rqspf.home) eo = od.rqspf.home;
              else if (od.spf && od.spf.home) eo = od.spf.home;
              else eo = 1.5;
            }
            if (eo > 0) hitOddsArr.push(eo);
          }
        }
        if (hitOddsArr.length >= 2) {
          var actual2in1 = 0, actual3in1 = 0;
          for (var a = 0; a < hitOddsArr.length; a++) {
            for (var b = a + 1; b < hitOddsArr.length; b++) {
              actual2in1 += 2 * hitOddsArr[a] * hitOddsArr[b];
            }
          }
          for (var a2 = 0; a2 < hitOddsArr.length; a2++) {
            for (var b2 = a2 + 1; b2 < hitOddsArr.length; b2++) {
              for (var c = b2 + 1; c < hitOddsArr.length; c++) {
                actual3in1 += 2 * hitOddsArr[a2] * hitOddsArr[b2] * hitOddsArr[c];
              }
            }
          }
          prizeVal = Math.round((actual2in1 + actual3in1) * 25).toFixed(0);
          prizeLabel = '中奖金额';
        }
      }

      var cutoffDisplay = '';
      if (matches.length > 0 && matches[0].startTime) {
        var stParts = matches[0].startTime.match(/(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
        if (stParts) {
          var stMonth = parseInt(stParts[1]) - 1, stDay = parseInt(stParts[2]), stHour = parseInt(stParts[3]), stMin = parseInt(stParts[4]);
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
              if (matchDow >= 1 && matchDow <= 5) cutoff = new Date(parseInt(mp[0]), parseInt(mp[1]) - 1, parseInt(mp[2]), 21, 30);
              else cutoff = new Date(parseInt(mp[0]), parseInt(mp[1]) - 1, parseInt(mp[2]), 22, 30);
            } else {
              cutoff = new Date(kickoff.getTime() - 30 * 60 * 1000);
              var dow = kickoff.getDay();
              if (dow >= 1 && dow <= 5 && stHour >= 22) cutoff = new Date(pYear, stMonth, stDay, 21, 30);
              else if ((dow === 0 || dow === 6) && stHour >= 23) cutoff = new Date(pYear, stMonth, stDay, 22, 30);
            }
            var pad2 = function (n) { return String(n).padStart(2, '0'); };
            cutoffDisplay = '截单时间：' + pad2(cutoff.getMonth() + 1) + '/' + pad2(cutoff.getDate()) + ' ' + pad2(cutoff.getHours()) + ':' + pad2(cutoff.getMinutes());
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
            for (var pi = 1; pi < parts.length; pi++) { if (parts[pi].indexOf(cand) !== 0) { ok = false; break; } }
            if (!ok) break;
            commonPrefix = cand;
          }
        }
        parts.forEach(function (pt) {
          var label = pt.trim();
          var ft = commonPrefix ? (commonPrefix + label.replace(commonPrefix, '')) : label.trim();
          var val = null;
          var isRQ = false;
          if (ft === '让胜' || ft.indexOf('让胜') >= 0) { val = oddsObj.rqspf && oddsObj.rqspf.home; isRQ = true; }
          else if (ft === '让平' || ft.indexOf('让平') >= 0) { val = oddsObj.rqspf && oddsObj.rqspf.draw; isRQ = true; }
          else if (ft === '让负' || ft.indexOf('让负') >= 0) { val = oddsObj.rqspf && oddsObj.rqspf.away; isRQ = true; }
          else if (ft.indexOf('总进球') >= 0 && oddsObj.totalGoals) {
            var gm = ft.match(/(\d+\+?)/);
            if (gm) val = oddsObj.totalGoals[gm[1]];
          }
          if (!val && ft.indexOf('球') >= 0 && oddsObj.totalGoals) {
            var gm2 = ft.match(/(\d+\+?)/);
            if (gm2) val = oddsObj.totalGoals[gm2[1]];
          }
          if (!val && !isRQ) {
            if (ft.indexOf('胜') >= 0 && ft.length <= 2) val = oddsObj.spf && oddsObj.spf.home;
            else if (ft.indexOf('平') >= 0 && ft.length <= 2) val = oddsObj.spf && oddsObj.spf.draw;
            else if (ft.indexOf('负') >= 0 && ft.length <= 2) val = oddsObj.spf && oddsObj.spf.away;
          }
          if (!val && !isRQ && oddsObj.spf) val = oddsObj.spf.home || oddsObj.spf.draw || oddsObj.spf.away;
          var subR = null;
          for (var si = 0; si < subResults.length; si++) {
            if (subResults[si].direction === label) { subR = subResults[si]; break; }
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
          if (val) resolved.push('<span style="color:' + subColor + '">' + displayLabel + '(' + val + ')</span>');
          else resolved.push('<span style="color:' + subColor + '">' + displayLabel + '(-)</span>');
        });
        return resolved.join('<span style="color:#fff">、</span>');
      }

      var matchRows = '';
      for (var mi4 = 0; mi4 < matches.length; mi4++) {
        var m = matches[mi4];
        var isMw = m.isMatchWon === true;
        var isMl = m.isMatchLose === true;
        var matchOddsHtml = resolveMatchOddsHtml(m, i);
        var numText = m.matchNum || '';
        var matchDateShort = '', matchTime = '';
        if (m.startTime) {
          var tm = m.startTime.match(/(\d{2}:\d{2})/);
          if (tm) matchTime = tm[1];
          var dm = m.startTime.match(/(\d{2})\/(\d{2})/) || m.startTime.match(/(\d{2})-(\d{2})/);
          if (dm) matchDateShort = dm[1] + '/' + dm[2];
        }
        var timeDisp = matchDateShort || matchTime ? (matchDateShort + ' ' + matchTime).trim() : '';
        matchRows += '<tr>' +
          '<td class="match-info-col">' +
          '<div class="match-num-text">' + numText + '</div>' +
          (timeDisp ? '<div class="match-time-sub">' + timeDisp + '</div>' : '') +
          '</td>' +
          '<td class="team-col">' +
          '<span class="plan-team-home">' + (m.homeName || '') + '</span>' +
          '<span class="plan-team-vs">vs</span>' +
          '<span class="plan-team-away">' + (m.visitName || '') + '</span>' +
          '</td>' +
          '<td class="odds-col">' + matchOddsHtml + '</td>' +
          '</tr>';
      }

      return '<div class="plan-card">' +
        '<div class="plan-card-head">' +
        '<div class="plan-left">' +
        '<span class="plan-soccer-icon"><img src="/assets/plan_icon.png?v=1" alt="" decoding="async"/></span>' +
        '<span class="plan-name">' + planName + '</span>' +
        '</div>' +
        '<span class="plan-pub-time">' + cutoffDisplay + '</span>' +
        '</div>' +
        '<div class="plan-amount-row">' +
        '<div class="plan-amount-col">' +
        '<div class="plan-amount-label">方案金额</div>' +
        '<div class="plan-amount-value">' + amountVal + '<span class="unit">元</span></div>' +
        '</div>' +
        '<div class="plan-amount-col">' +
        '<div class="plan-amount-label">' + prizeLabel + '</div>' +
        '<div class="plan-amount-value">' + prizeVal + '<span class="unit">元</span></div>' +
        '</div>' +
        '<div class="plan-amount-col">' +
        '<div class="plan-amount-label">方案状态</div>' +
        '<div class="plan-amount-value">' + (isWon ? '已中奖' : (isLose ? '未中奖' : '未开奖')) + '</div>' +
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
        '<div>' + (p.playType || '混合投注') + '</div>' +
        '<div>' + (p.passType === '混合过关' ? '2场2串1，3场3串1' : (p.matchCount || 2) + '场' + (p.passType || '2串1')) + '</div>' +
        '<div>' + (p.betCount || 250) + '注' + (p.multiplier || 25) + '倍' + (p.ticketCount || 10) + '票</div>' +
        '</div>' +
        (isWon ? '<div class="plan-win-stamp"><svg width="38" height="38" viewBox="0 0 38 38"><circle cx="19" cy="19" r="17" fill="none" stroke="#EF4444" stroke-width="2"/><text x="19" y="25" text-anchor="middle" font-size="18" font-weight="900" fill="#EF4444" transform="rotate(-10,19,19)">中</text></svg></div>' : '') +
        (isLose ? '<div class="plan-lose-stamp"><svg width="38" height="38" viewBox="0 0 38 38"><circle cx="19" cy="19" r="17" fill="none" stroke="#9AA6B2" stroke-width="2"/><text x="19" y="25" text-anchor="middle" font-size="16" font-weight="900" fill="#9AA6B2" transform="rotate(-10,19,19)">未中</text></svg></div>' : '') +
        '</div>' +
        '<div class="plan-match-section">' +
        '<table class="plan-match-table">' +
        '<thead><tr><th>场次</th><th>对阵</th><th>投注(赔率)</th></tr></thead>' +
        '<tbody>' + matchRows + '</tbody>' +
        '</table>' +
        '</div>' +
        '</div>';
    }).join('');
  }).catch(function (e) {
    el.innerHTML = '<div style="text-align:center;padding:80px 0;color:var(--text3);">' + e.message + '</div>';
  });
}
