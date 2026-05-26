/**
 * 第一阶段：字段解析模块
 * 将 API 原始数据无损映射为 34 个标准量化变量
 */
function parse(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const vars = {};

  // ========== 1. 比分差分布（10维，直接提取） ==========
  vars.homeWinGap_1 = parseInt(raw.homeWinGap_1) || 0;
  vars.homeWinGap_2 = parseInt(raw.homeWinGap_2) || 0;
  vars.homeLoseGap_1 = parseInt(raw.homeLoseGap_1) || 0;
  vars.homeLoseGap_2 = parseInt(raw.homeLoseGap_2) || 0;
  vars.awayWinGap_1 = parseInt(raw.awayWinGap_1) || 0;
  vars.awayWinGap_2 = parseInt(raw.awayWinGap_2) || 0;
  vars.awayLoseGap_1 = parseInt(raw.awayLoseGap_1) || 0;
  vars.awayLoseGap_2 = parseInt(raw.awayLoseGap_2) || 0;

  // SPF 战绩文本 → 提取平局场次
  vars.homeSpf = raw.homeSpf || '';
  vars.guestSpf = raw.guestSpf || '';
  vars.homeDraw = extractNumBefore(vars.homeSpf, '平');
  vars.awayDraw = extractNumBefore(vars.guestSpf, '平');

  // ========== 2. 进球分布（12维，直接提取） ==========
  vars.homeGoal0 = parseInt(raw.homeWinQiu_0) || 0;
  vars.homeGoal1 = parseInt(raw.homeWinQiu_1) || 0;
  vars.homeGoal2Plus = parseInt(raw.homeWinQiu_2) || 0;
  vars.homeLose0 = parseInt(raw.homeLoseQiu_0) || 0;
  vars.homeLose1 = parseInt(raw.homeLoseQiu_1) || 0;
  vars.homeLose2Plus = parseInt(raw.homeLoseQiu_2) || 0;
  vars.awayGoal0 = parseInt(raw.awayWinQiu_0) || 0;
  vars.awayGoal1 = parseInt(raw.awayWinQiu_1) || 0;
  vars.awayGoal2Plus = parseInt(raw.awayWinQiu_2) || 0;
  vars.awayLose0 = parseInt(raw.awayLoseQiu_0) || 0;
  vars.awayLose1 = parseInt(raw.awayLoseQiu_1) || 0;
  vars.awayLose2Plus = parseInt(raw.awayLoseQiu_2) || 0;

  // ========== 3. 场均得失球（4维，正则提取） ==========
  vars.homeFieldGoalAvg = extractAvg(raw.homeDxqSame10Desc, '进球');
  vars.homeFieldLoseAvg = extractAvg(raw.homeDxqSame10Desc, '失球');
  vars.homeRecentGoalAvg = extractAvg(raw.homeDxqDesc, '进球');
  vars.homeRecentLoseAvg = extractAvg(raw.homeDxqDesc, '失球');
  vars.awayFieldGoalAvg = extractAvg(raw.awayDxqSame10Desc, '进球');
  vars.awayFieldLoseAvg = extractAvg(raw.awayDxqSame10Desc, '失球');
  vars.awayRecentGoalAvg = extractAvg(raw.guestDxqDesc, '进球');
  vars.awayRecentLoseAvg = extractAvg(raw.guestDxqDesc, '失球');

  // ========== 4. 攻防效率（4维，正则提取冒号后绝对值） ==========
  vars.homeAttackEfficiency = extractEfficiency(raw.homeEnterEfficiency);
  vars.homeDefendEfficiency = extractEfficiency(raw.homePreventEfficiency);
  vars.awayAttackEfficiency = extractEfficiency(raw.guestEnterEfficiency);
  vars.awayDefendEfficiency = extractEfficiency(raw.guestPreventEfficiency);

  // ========== 5. 补充字段 ==========
  vars.homeFieldGoal = parseFloat(raw.homeFieldGoal) || vars.homeFieldGoalAvg;
  vars.homeFieldLose = parseFloat(raw.homeFieldLose) || vars.homeFieldLoseAvg;

  // 大球率
  vars.homeOverRate = parsePercent(raw.homeDxqPercentStr);
  vars.awayOverRate = parsePercent(raw.guestDxqPercentStr);

  // 实力值
  vars.homePower = parseInt(raw.homePower) || 50;
  vars.awayPower = parseInt(raw.guestPower) || 50;

  // 赢盘率
  vars.homeWinPanRate = parseFloat(raw.homeWinPan) || 0;
  vars.awayWinPanRate = parseFloat(raw.guestWinPan) || 0;

  // 赔率
  vars.homeWinAward = parseFloat(raw.homeWinAward) || 0;
  vars.awayWinAward = parseFloat(raw.guestWinAward) || 0;
  vars.drawAward = parseFloat(raw.drawAward) || 0;

  // 让球数
  vars.rq = parseInt(raw.rq) || 0;

  // 交锋数据
  vars.jiaoFenDesc = raw.jiaoFenDesc || '';
  vars.jiaoFenScores = [];
  if (raw.jiaoFenMatch1) vars.jiaoFenScores.push(extractScore(raw.jiaoFenMatch1));
  if (raw.jiaoFenMatch2) vars.jiaoFenScores.push(extractScore(raw.jiaoFenMatch2));

  // 标准化净胜球序列（用于7场阈值）
  vars.homeGoalDiffSeries = buildGoalDiffSeries(
    vars.homeWinGap_2, vars.homeWinGap_1, vars.homeDraw,
    vars.homeLoseGap_1, vars.homeLoseGap_2
  );
  vars.awayGoalDiffSeries = buildGoalDiffSeries(
    vars.awayWinGap_2, vars.awayWinGap_1, vars.awayDraw,
    vars.awayLoseGap_1, vars.awayLoseGap_2
  );

  return vars;
}

// ========== 工具函数 ==========

/**
 * 从文本中提取"XX字"之前的数字，如 "4胜5平1负" 提取平前面数字 5
 */
function extractNumBefore(str, char) {
  if (!str) return 0;
  const idx = str.indexOf(char);
  if (idx < 0) return 0;
  const before = str.slice(0, idx);
  const match = before.match(/(\d+)\s*$/);
  return match ? parseInt(match[1]) : 0;
}

/**
 * 从描述中提取均值，如 "近期:进球1.4 失球1.3" → 提取 "进球" 后的数字
 */
function extractAvg(desc, keyword) {
  if (!desc) return 0;
  const idx = desc.indexOf(keyword);
  if (idx < 0) return 0;
  const after = desc.slice(idx + keyword.length);
  const match = after.match(/([\d.]+)/);
  return match ? parseFloat(match[1]) : 0;
}

/**
 * 从效率描述中提取绝对值，如 "进攻:0.29" → 0.29; "防守:-0.11" → 0.11
 */
function extractEfficiency(desc) {
  if (!desc) return 0;
  const match = desc.match(/:([\-\d.]+)/);
  return match ? Math.abs(parseFloat(match[1])) : 0;
}

/**
 * 百分比字符串 → 数值，如 "50%" → 0.5
 */
function parsePercent(str) {
  if (!str) return 0;
  const match = String(str).match(/([\d.]+)/);
  return match ? parseFloat(match[1]) / 100 : 0;
}

/**
 * 从交锋描述中提取比分，如 "芬超 2026-05-10 拉赫蒂 1:1 玛丽港 平" → {h:1, a:1}
 */
function extractScore(desc) {
  if (!desc) return null;
  const match = desc.match(/(\d+)\s*:\s*(\d+)/);
  if (!match) return null;
  return { h: parseInt(match[1]), a: parseInt(match[2]) };
}

/**
 * 构建净胜球序列数组（用于7场阈值统计）
 * 赢2球及以上→+2, 赢1球→+1, 平→0, 输1球→-1, 输2球及以上→-2
 */
function buildGoalDiffSeries(w2, w1, d, l1, l2) {
  const series = [];
  for (let i = 0; i < w2; i++) series.push(2);
  for (let i = 0; i < w1; i++) series.push(1);
  for (let i = 0; i < d; i++) series.push(0);
  for (let i = 0; i < l1; i++) series.push(-1);
  for (let i = 0; i < l2; i++) series.push(-2);
  return series;
}

module.exports = { parse };
