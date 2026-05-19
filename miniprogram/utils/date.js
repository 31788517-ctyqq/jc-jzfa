const WEEK_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function formatDate(date) {
  const d = date || new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatTime(date) {
  const d = date || new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function getToday() {
  return formatDate(new Date());
}

function getDateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return formatDate(d);
}

function getWeekDay(dateStr) {
  const d = new Date(dateStr);
  return WEEK_NAMES[d.getDay()];
}

function getRoundDisplay(dateStr, num) {
  if (!dateStr) return num || '';
  const weekDay = getWeekDay(dateStr);
  return num ? `${weekDay}${num}` : weekDay;
}

module.exports = { formatDate, formatTime, getToday, getDateDaysAgo, getWeekDay, getRoundDisplay };
