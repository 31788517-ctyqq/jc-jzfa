import { api } from '../api.js';
import { getCache, setCache } from '../utils.js';
import * as state from '../vendor.js';
// 盈利显示（元，整数，无小数点）
import { loadCSS } from '../vendor.js';
loadCSS('../../css/page-income.css');

function _fmtIncome(val) {
  val = Math.round(val || 0);
  return val >= 0 ? '+' + val : String(val);
}

function _getIncomeColor(val) {
  return Number(val || 0) >= 0 ? 'var(--red)' : 'var(--green)';
}

function _setIncomeColor(el, val) {
  if (!el) return;
  el.style.setProperty('color', _getIncomeColor(val), 'important');
}

function _normalizeIncomeDirection(direction) {
  if (
    direction === 'all' ||
    direction === 'expert' ||
    direction === 'my' ||
    direction === 'ai_tg' ||
    direction === 'wc'
  )
    return direction;
  return 'expert';
}

function _toPlanCnByFilter(planFilter) {
  const map = {
    plan_1: '方案一',
    plan_2: '方案二',
    plan_3: '方案三',
    plan_4: '方案四',
    plan_5: '方案五',
    plan_6: '方案六',
    plan_7: '方案七',
  };
  return map[planFilter] || '';
}

function _isWorldCupPlanName(planName) {
  const pn = String(planName || '').trim();
  return pn.indexOf('世界杯') === 0;
}

function _isAiTotalGoalsPlanName(planName) {
  const pn = String(planName || '').trim();
  return pn.indexOf('方案A') === 0;
}

function _matchDetailByDirectionAndPlan(detail, direction, planFilter) {
  const pn = String((detail && detail.plan) || '').trim();

  if (direction === 'wc' && !_isWorldCupPlanName(pn)) return false;
  if (direction === 'ai_tg' && !_isAiTotalGoalsPlanName(pn)) return false;
  if (direction === 'expert' && (_isWorldCupPlanName(pn) || _isAiTotalGoalsPlanName(pn))) return false;

  if (planFilter && planFilter !== 'all') {
    const pf = String(planFilter);

    if (pf.indexOf('worldcup_') === 0) {
      const wcIdx = pf.replace('worldcup_', '');
      return pn === '世界杯' + wcIdx;
    }

    if (pf === 'A123') return pn.indexOf('方案A123') === 0;
    if (pf === 'A345') return pn.indexOf('方案A345') === 0;

    const expName = _toPlanCnByFilter(pf);
    if (expName) return pn === expName;

    // 我的方案/全部：按方案名兜底包含匹配
    return pn.indexOf(pf) >= 0;
  }

  return true;
}

export function loadIncome(force) {
  if (state.incomeLoaded && !force) return;
  state.setIncomeLoaded(true);
  const resultEl = document.getElementById('incomeResult');
  if (!resultEl) return;
  resultEl.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载中...</div>';

  const timeVal = window.getDDVal ? window.getDDVal('dd-incTime') : 'all';
  const days = timeVal === 'all' ? 0 : parseInt(timeVal) || 0;
  const plan = window.getDDVal ? window.getDDVal('dd-incPlan') || 'all' : 'all';
  const rawDirection = window.getDDVal ? window.getDDVal('dd-incDir') || 'all' : 'all';
  const direction = _normalizeIncomeDirection(rawDirection);

  if (direction !== rawDirection && window.selectDD) {
    const directionText =
      direction === 'all'
        ? '全部'
        : direction === 'my'
          ? '我的方案'
          : direction === 'ai_tg'
            ? '总进球三向'
            : direction === 'wc'
              ? '世界杯'
              : '专家博热方案';
    window.selectDD('dd-incDir', direction, directionText);
  }

  // ★ P1: sessionStorage 缓存命中（含筛选参数）
  const cacheKey = 'income-stats:v2:' + days + ':' + plan + ':' + direction;
  const cached = !force ? getCache(cacheKey) : null;
  if (cached) {
    // 兼容旧缓存结构（仅 html 字符串）
    if (typeof cached === 'string') {
      resultEl.innerHTML = cached;
      return;
    }

    const cachedSummary = (cached && cached.summary) || {};
    const ctp = document.getElementById('incTotalPlans');
    const cwr = document.getElementById('incWinRate');
    const cIncomeEl = document.getElementById('incTotalIncome');
    const cIncome = cachedSummary.totalIncome || 0;
    if (ctp) ctp.textContent = cachedSummary.totalPlans || 0;
    if (cwr) cwr.textContent = (cachedSummary.winRate || 0) + '%';
    if (cIncomeEl) {
      cIncomeEl.textContent = _fmtIncome(cIncome);
      _setIncomeColor(cIncomeEl, cIncome);
    }

    resultEl.innerHTML = cached.html || '';
    return;
  }

  api('income-stats', { days: days, plan: plan, direction: direction })
    .then(function (data) {
      const s = data.summary || {};
      const itp = document.getElementById('incTotalPlans');
      const iwr = document.getElementById('incWinRate');
      if (itp) itp.textContent = s.totalPlans || 0;
      if (iwr) iwr.textContent = (s.winRate || 0) + '%';

      const incomeEl = document.getElementById('incTotalIncome');
      const income = s.totalIncome || 0;
      if (incomeEl) {
        incomeEl.textContent = _fmtIncome(income);
        _setIncomeColor(incomeEl, income);
      }

      const records = data.records || [];
      const details = (data.details || []).filter(function (d) {
        return _matchDetailByDirectionAndPlan(d, direction, plan);
      });

      let html = '';
      if (records.length === 0) {
        resultEl.innerHTML = '<div class="hint-box">暂无方案收入数据</div>';
        return;
      }

      // ====== 日汇总表格 ======
      html += '<div class="income-list">';
      html +=
        '<div class="income-header-row"><span>时间</span><span class="inc-col-hit">命中数</span><span class="inc-col-rate">命中率</span><span class="inc-col-income">盈利(元)</span></div>';

      records.forEach(function (r) {
        const incColor = _getIncomeColor(r.income);
        const dateShort = r.date.slice(5).replace('-', '/');

        html +=
          '<div class="income-row">' +
          '<span class="income-date">' +
          dateShort +
          '</span>' +
          '<span class="income-hit">' +
          (r.hitCount || 0) +
          '/' +
          (r.totalPlans || 0) +
          '</span>' +
          '<span class="income-rate">' +
          (r.hitRate || 0) +
          '%</span>' +
          '<span class="income-value" style="color:' +
          incColor +
          ' !important">' +
          _fmtIncome(r.income) +
          '</span>' +
          '</div>';
      });
      html += '</div>';

      // ====== 方案命中明细（与推荐方向命中查询同款表格样式） ======
      if (details.length > 0) {
        html += '<div class="chart-box" style="margin-top:20px">';
        html += '<div class="chart-header"><span class="chart-title">方案命中明细</span></div>';
        html +=
          '<table class="filter-detail-table"><thead><tr>' +
          '<th class="fdt-date">时间</th>' +
          '<th>方案名</th>' +
          '<th class="fdt-match">场次</th>' +
          '<th class="fdt-dir">方向</th>' +
          '<th class="fdt-income">盈利(元)</th>' +
          '</tr></thead><tbody>';

        // 按时间倒序（最新在前）
        details.sort(function (a, b) {
          return (b.date || '').localeCompare(a.date || '');
        });
        details.forEach(function (d) {
          const incColor = _getIncomeColor(d.income);
          const dateShort = d.date.slice(5).replace('-', '/');

          html +=
            '<tr>' +
            '<td class="fdt-date">' +
            dateShort +
            '</td>' +
            '<td style="color:' +
            incColor +
            ';font-weight:600">' +
            (d.plan || '--') +
            '</td>' +
            '<td class="fdt-match">' +
            (d.matchNums || '--').split(' / ').join('<br>') +
            '</td>' +
            '<td class="fdt-dir">' +
            (d.direction || '--').split(' / ').join('<br>') +
            '</td>' +
            '<td class="fdt-income" style="color:' +
            incColor +
            ' !important">' +
            _fmtIncome(d.income) +
            '</td>' +
            '</tr>';
        });
        html += '</tbody></table></div>';
      }

      resultEl.innerHTML = html;
      setCache(cacheKey, {
        summary: {
          totalPlans: s.totalPlans || 0,
          winRate: s.winRate || 0,
          totalIncome: s.totalIncome || 0,
        },
        html: html,
      });
    })
    .catch(function (e) {
      resultEl.innerHTML = '<div class="loading">' + e.message + '</div>';
      state.setIncomeLoaded(false);
    });
}

// 方向切换回调（下拉选择时触发，仅更新 UI 标记，不自动查询）
// ★ 接收方向参数避免异步 selectDD 导致的 DOM 读取竞态
export function onIncDirChange(dir) {
  let incDir = dir || (window.getDDVal ? window.getDDVal('dd-incDir') : 'expert');
  if (incDir !== 'all' && incDir !== 'expert' && incDir !== 'my' && incDir !== 'ai_tg' && incDir !== 'wc') {
    if (window.selectDD) window.selectDD('dd-incDir', 'expert', '专家博热方案');
    incDir = 'expert';
  }
  const ddPlan = document.getElementById('dd-incPlan');
  if (!ddPlan) return;
  const menu = ddPlan.querySelector('.filter-dd-menu');
  if (!menu) return;

  // 重置为"全部"选中
  if (window.selectDD) window.selectDD('dd-incPlan', 'all', '全部');

  if (incDir === 'wc') {
    menu.innerHTML =
      '<li data-val="all" class="filter-dd-option selected" onclick="selectDD(\'dd-incPlan\',\'all\',\'全部\')">全部</li>' +
      '<li data-val="worldcup_01" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'worldcup_01\',\'世界杯01\')">世界杯01</li>' +
      '<li data-val="worldcup_02" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'worldcup_02\',\'世界杯02\')">世界杯02</li>' +
      '<li data-val="worldcup_03" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'worldcup_03\',\'世界杯03\')">世界杯03</li>' +
      '<li data-val="worldcup_04" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'worldcup_04\',\'世界杯04\')">世界杯04</li>' +
      '<li data-val="worldcup_05" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'worldcup_05\',\'世界杯05\')">世界杯05</li>' +
      '<li data-val="worldcup_06" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'worldcup_06\',\'世界杯06\')">世界杯06</li>' +
      '<li data-val="worldcup_07" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'worldcup_07\',\'世界杯07\')">世界杯07</li>' +
      '<li data-val="worldcup_08" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'worldcup_08\',\'世界杯08\')">世界杯08</li>';
  } else if (incDir === 'ai_tg') {
    menu.innerHTML =
      '<li data-val="all" class="filter-dd-option selected" onclick="selectDD(\'dd-incPlan\',\'all\',\'全部\')">全部</li>' +
      '<li data-val="A123" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'A123\',\'方案A123\')">方案A123（1、2、3球）</li>' +
      '<li data-val="A345" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'A345\',\'方案A345\')">方案A345（3、4、5球）</li>';
  } else if (incDir === 'expert' || incDir === 'all') {
    menu.innerHTML =
      '<li data-val="all" class="filter-dd-option selected" onclick="selectDD(\'dd-incPlan\',\'all\',\'全部\')">全部</li>' +
      '<li data-val="plan_1" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_1\',\'方案一\')">方案一</li>' +
      '<li data-val="plan_2" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_2\',\'方案二\')">方案二</li>' +
      '<li data-val="plan_3" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_3\',\'方案三\')">方案三</li>' +
      '<li data-val="plan_4" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_4\',\'方案四\')">方案四</li>' +
      '<li data-val="plan_5" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_5\',\'方案五\')">方案五</li>' +
      '<li data-val="plan_6" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_6\',\'方案六\')">方案六</li>' +
      '<li data-val="plan_7" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_7\',\'方案七\')">方案七</li>';
  } else {
    menu.innerHTML =
      '<li data-val="all" class="filter-dd-option selected" onclick="selectDD(\'dd-incPlan\',\'all\',\'全部\')">全部</li>' +
      '<li data-val="plan_1" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_1\',\'方案一\')">方案一</li>' +
      '<li data-val="plan_2" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_2\',\'方案二\')">方案二</li>' +
      '<li data-val="plan_3" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_3\',\'方案三\')">方案三</li>' +
      '<li data-val="plan_4" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_4\',\'方案四\')">方案四</li>' +
      '<li data-val="plan_5" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_5\',\'方案五\')">方案五</li>' +
      '<li data-val="plan_6" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_6\',\'方案六\')">方案六</li>' +
      '<li data-val="plan_7" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_7\',\'方案七\')">方案七</li>';
  }
}
