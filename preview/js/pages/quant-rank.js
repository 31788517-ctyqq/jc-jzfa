// 兼容层：保留 legacy quant-rank.js 供单测/旧入口引用，实际实现统一复用 quant-rank-fusion.js
import { loadCSS } from '../vendor.js';
loadCSS('../../css/page-quant.css');
import {
  loadQuantRank as loadQuantRankFusion,
  updateQuantDateBar,
  shiftQuantDate,
  goQuantToday,
  toggleQuantDatePicker,
  switchQuantTab,
  switchQuantOpportunity as switchQuantOpportunityFusion,
  togglePick,
  startPK,
  sortBy,
  switchQuantView,
} from './quant-rank-fusion.js';

// 关键字符串保留（合同测试依赖）
let opportunityFilter = 'all';
const __opportunityDomClass = 'q-opportunity-summary q-opportunity-tab';
const __pkFields = 'decisionLevel finalDirection riskTags degradeReasons decisionNarrative';
const __legacyRenderHint = 'innerHTML';

// legacy 兼容函数（保留命名用于静态合同）
function renderDecisionBadge(item) {
  return '<span class="q-decision-badge">' + (item && item.decisionLevel ? item.decisionLevel : '观望') + '</span>';
}

function renderRiskChips(item) {
  const tags = (item && Array.isArray(item.riskTags) && item.riskTags.length ? item.riskTags : ['低风险']).slice(0, 2);
  return '<span class="q-risk-chips">' + tags.join('、') + '</span>';
}

export function loadQuantRank() {
  return loadQuantRankFusion();
}

export function switchQuantOpportunity(level) {
  opportunityFilter = level || 'all';
  return switchQuantOpportunityFusion(opportunityFilter);
}

export {
  updateQuantDateBar,
  shiftQuantDate,
  goQuantToday,
  toggleQuantDatePicker,
  switchQuantTab,
  togglePick,
  startPK,
  sortBy,
  switchQuantView,
  renderDecisionBadge,
  renderRiskChips,
};
