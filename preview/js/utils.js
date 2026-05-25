// 颜色常量、工具函数
export const API = '/api';
export const DIR_COLORS = {
  '胜': '#EF4444', '平': '#FBBF24', '负': '#60A5FA',
  '胜平': '#34D399', '平负': '#F472B6', '胜负': '#A78BFA',
  '让胜': '#18E0E0', '让平': '#F59E0B', '让负': '#94A3B8'
};
export const CAT_NAMES = ['综合排名', '胜平负', '半全场', '进球数', '双选', '让球'];
export const WEEK_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export const MIN_PLAN_DATE = '2026-03-19';

export function getWeekDay(dateStr) {
  return WEEK_NAMES[new Date(dateStr).getDay()];
}

export function formatDate(d) {
  var y = d.getFullYear(), m = (d.getMonth() + 1).toString().padStart(2, '0'), day = d.getDate().toString().padStart(2, '0');
  return y + '-' + m + '-' + day;
}

export function formatDateCN(d) {
  var m = (d.getMonth() + 1).toString().padStart(2, '0'), day = d.getDate().toString().padStart(2, '0');
  return m + '月' + day + '日 ' + WEEK_NAMES[d.getDay()];
}
