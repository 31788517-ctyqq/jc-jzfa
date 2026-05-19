const CONSTANTS = require('./constants');

function getStatusText(status) {
  const map = {
    0: '未开始', 1: '进行中', 2: '已结束', 3: '取消', 4: '延期'
  };
  return map[status] || '未知';
}

function getResultText(result) {
  if (result === 1) return '中';
  if (result === 0) return '未中';
  return '待开';
}

function getDirectionColor(direction) {
  return CONSTANTS.DIRECTION_COLORS[direction] || '#999999';
}

function truncateText(text, maxLen = 5) {
  if (!text) return '';
  return text.length > maxLen ? text.slice(0, maxLen) + '..' : text;
}

function getMedalIcon(rank) {
  const medals = CONSTANTS.RANKING_MEDALS;
  if (rank <= 3) return medals[rank - 1];
  return String(rank);
}

module.exports = { getStatusText, getResultText, getDirectionColor, truncateText, getMedalIcon };
