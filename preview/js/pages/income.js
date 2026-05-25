import { api } from '../api.js';
import * as state from '../state.js';

export function loadIncome(force) {
  if (!state.incomeLoaded && !force) return;
  if (!force && state.incomeLoaded) return;
  state.setIncomeLoaded(true);
  var resultEl = document.getElementById('incomeResult');
  if (!resultEl) return;
  resultEl.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载中...</div>';

  var timeVal = window.getDDVal ? window.getDDVal('dd-incTime') : 'all';
  var days = timeVal === 'all' ? 0 : parseInt(timeVal) || 0;
  var plan = window.getDDVal ? window.getDDVal('dd-incPlan') || 'all' : 'all';

  api('income-stats', { days: days, plan: plan }).then(function (data) {
    var s = data.summary || {};
    var itp = document.getElementById('incTotalPlans');
    var iwr = document.getElementById('incWinRate');
    if (itp) itp.textContent = s.totalPlans || 0;
    if (iwr) iwr.textContent = (s.winRate || 0) + '%';

    var incomeEl = document.getElementById('incTotalIncome');
    var income = s.totalIncome || 0;
    if (incomeEl) {
      incomeEl.textContent = income;
      incomeEl.style.color = income >= 0 ? '#EF4444' : '#22C55E';
    }

    var records = data.records || [];
    if (records.length === 0) {
      resultEl.innerHTML = '<div class="hint-box">暂无方案收入数据</div>';
      return;
    }

    var html = '<div class="income-list">';
    html += '<div class="income-header-row"><span>时间</span><span class="inc-col-hit">命中数</span><span class="inc-col-rate">命中率</span><span class="inc-col-income">盈利</span></div>';

    records.forEach(function (r) {
      var incColor = r.income >= 0 ? '#EF4444' : '#22C55E';
      var dateShort = r.date.slice(5).replace('-', '/');

      html += '<div class="income-row">' +
        '<span class="income-date">' + dateShort + '</span>' +
        '<span class="income-hit">' + (r.hitCount || 0) + '/' + (r.totalPlans || 0) + '</span>' +
        '<span class="income-rate">' + (r.hitRate || 0) + '%</span>' +
        '<span class="income-value" style="color:' + incColor + '">' + r.income + '</span>' +
        '</div>';
    });
    html += '</div>';
    resultEl.innerHTML = html;
  }).catch(function (e) {
    resultEl.innerHTML = '<div class="loading">' + e.message + '</div>';
    state.setIncomeLoaded(false);
  });
}
