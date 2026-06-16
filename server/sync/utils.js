/**
 * server/sync/utils.js
 * 数据同步共享工具函数 — 从 data_sync.js + scheduler_v2.js 提取
 * ★ P1-2 Phase A: 纯函数提取，消除双文件重复定义
 */
const fs = require('fs');

/** 北京时间日期格式化 yyyy-MM-dd */
function fmtLocal(dd) {
  return (
    dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0') + '-' + String(dd.getDate()).padStart(2, '0')
  );
}

/** 获取当前日期+星期 */
function getCurrentPeriod() {
  const weekMap = { 0: '周日', 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六' };
  const now = new Date();
  return { date: fmtLocal(now), week: weekMap[now.getDay()] };
}

/** 原子写入：先写 .tmp 再 rename（防写崩溃残留半截文件） */
function atomicWrite(filePath, data) {
  const tmpFile = filePath + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(data));
  fs.renameSync(tmpFile, filePath);
}

/** 通知数据重载（当前为 no-op，服务端通过 mtimeMs 自动检测） */
function notifyReload() {
  // Express getDataJson() 通过 stat.mtimeMs 自动检测 data.json 变更并重载
  // 无需额外通知
}

module.exports = { fmtLocal, getCurrentPeriod, atomicWrite, notifyReload };
