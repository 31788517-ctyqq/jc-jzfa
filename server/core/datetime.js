// server/core/datetime.js
// ★ 全局唯一时区工具 — 业务代码禁止直接 new Date().toISOString()
// 北京时间 (UTC+8) 统一入口，解决跨日期/时区问题

const CN_OFFSET = 8 * 60 * 60 * 1000; // UTC+8 毫秒偏移

function cnNow() {
  const now = new Date();
  return new Date(now.getTime() + CN_OFFSET - now.getTimezoneOffset() * 60000);
}

module.exports = {
  /** 今天的北京时间 yyyy-MM-dd */
  todayCN() {
    return cnNow().toISOString().slice(0, 10);
  },

  /** 当前北京时间 ISO 字符串 */
  nowISO() {
    return cnNow().toISOString();
  },

  /** 任意 Date → 北京时间 yyyy-MM-dd */
  fmtCN(date) {
    const d = new Date(date);
    return new Date(d.getTime() + CN_OFFSET - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  },

  /** 竞彩唯一键: date|num (防止跨周编号重复) */
  matchKey(date, num) {
    return `${date}|${num}`;
  },
};
