/**
 * 功守道本地测试脚本
 * node server/gongshoudao/test.js
 */
const fetch = require('./fetch');
const parser = require('./parser');
const attack = require('./attack');
const goal = require('./goal');
const diff = require('./diff');
const gs = require('./index');

async function test() {
  console.log('=== 功守道本地测试 ===\n');

  // 1. 拉取数据
  console.log('[1] 拉取 API 数据...');
  let results;
  try {
    results = await fetch.fetchAndRelate('2026-05-26');
  } catch(e) {
    console.log('  API 请求失败:', e.message);
    console.log('  => 尝试备用日期 2026-05-25');
    results = await fetch.fetchAndRelate('2026-05-25');
  }

  const matchIds = Object.keys(results);
  console.log('  匹配到', matchIds.length, '场比赛\n');

  if (matchIds.length === 0) {
    console.log('❌ 无可用数据，测试终止');
    return;
  }

  // 取第一场有统计数据的比赛
  const mid = matchIds[0];
  const stats = results[mid];
  const dataFile = require('../data.json');
  const m = dataFile.m[mid];

  console.log('[2] 测试比赛:', m.homeName, 'vs', m.visitName);
  console.log('  联赛:', m.leagueName, ' 编号:', m.num, '\n');

  // 2. 字段解析
  console.log('[3] 第一阶段：字段解析');
  const vars = parser.parse(stats);
  console.log('  进球 [0/1/2+]:');
  console.log('    主队进球:', vars.homeGoal0, vars.homeGoal1, vars.homeGoal2Plus);
  console.log('    客队进球:', vars.awayGoal0, vars.awayGoal1, vars.awayGoal2Plus);
  console.log('  赢球差 [W2/W1/D/L1/L2]:');
  console.log('    主队:', vars.homeWinGap_2, vars.homeWinGap_1, vars.homeDraw, vars.homeLoseGap_1, vars.homeLoseGap_2);
  console.log('    客队:', vars.awayWinGap_2, vars.awayWinGap_1, vars.awayDraw, vars.awayLoseGap_1, vars.awayLoseGap_2);
  console.log('  攻防效率:', vars.homeAttackEfficiency, vars.homeDefendEfficiency, '|', vars.awayAttackEfficiency, vars.awayDefendEfficiency);
  console.log('  场均进球/失球:', vars.homeRecentGoalAvg, '/', vars.homeRecentLoseAvg, '|', vars.awayRecentGoalAvg, '/', vars.awayRecentLoseAvg);
  console.log('  净胜球序列长度:', vars.homeGoalDiffSeries.length, '/', vars.awayGoalDiffSeries.length, '\n');

  // 3. 实力分析
  console.log('[4] 第二+三阶段：实力分析');
  const attResult = attack.analyze(vars);
  console.log('  进攻优势:', attResult.attackAdvantage, '(value:', attResult.attackAdvantageValue + ')');
  console.log('  防守优势:', attResult.defenseAdvantage, '(value:', attResult.defenseAdvantageValue + ')');
  console.log('  攻守格局:', attResult.attackPattern);
  console.log('  进攻权重:', attResult.attackWeightHome, 'vs', attResult.attackWeightAway);
  console.log('  防守权重:', attResult.defenseWeightHome, 'vs', attResult.defenseWeightAway);
  console.log('  综合优势:', attResult.totalAdvantage, '(value:', attResult.totalAdvantageValue + ')');
  console.log('  实力阶梯:', attResult.ladder.label, '(level:', attResult.ladder.level + ')');
  console.log('  交叉分布:', '主胜客负=' + attResult.cross.crossWin, '平局=' + attResult.cross.crossDraw, '主负客胜=' + attResult.cross.crossLose, '\n');

  // 4. 大小球
  console.log('[5] 第四阶段：大小球');
  const goalRes = goal.analyze(vars, attResult.totalAdvantagePct);
  console.log('  主客权重:', goalRes.homeWeight, 'vs', goalRes.awayWeight);
  console.log('  得失球:', goalRes.goalDiffHome, 'vs', goalRes.goalDiffAway);
  console.log('  总进球期望:', goalRes.totalGoalsExpect, '(value:', goalRes.totalGoalsValue + ')');
  console.log('  xG 主/客:', goalRes.xgHome.toFixed(2), '/', goalRes.xgAway.toFixed(2));
  console.log('  弹窗区间:', goalRes.goalRange.range, '(综合线:', goalRes.goalRange.compositeLine + ')', '\n');

  // 5. 净胜球
  console.log('[6] 第五阶段：让球分析');
  const diffRes = diff.analyze(vars, goalRes.xgHome, goalRes.xgAway);
  console.log('  预期净胜球差:', diffRes._diffXG.toFixed(4));
  console.log('  Total_战:', diffRes._totalStrength.normalized.toFixed(4));
  console.log('  Anchor:', diffRes.anchor.label, '(' + diffRes.anchor.anchor + ')');
  console.log('  维度一(主赢∩客输):', diffRes.sevenMatch.dimension1.label, '(共' + diffRes.sevenMatch.dimension1.total + '场, 主' + diffRes.sevenMatch.dimension1.hCount + '客' + diffRes.sevenMatch.dimension1.aCount + ')');
  console.log('  维度二(主输∩客赢):', diffRes.sevenMatch.dimension2.label, '(共' + diffRes.sevenMatch.dimension2.total + '场, 主' + diffRes.sevenMatch.dimension2.hCount + '客' + diffRes.sevenMatch.dimension2.aCount + ')');
  console.log('  共振裁决:', diffRes.resonance.verdict, '\n');

  // 6. 完整弹窗数据
  console.log('[7] 完整弹窗 JSON:');
  const full = gs.computeSingleMatch(stats, m);
  const summary = {
    attackAdvantage: full.attackAdvantage,
    attackAdvantageValue: full.attackAdvantageValue,
    defenseAdvantage: full.defenseAdvantage,
    defenseAdvantageValue: full.defenseAdvantageValue,
    attackPattern: full.attackPattern,
    attackWeightHome: full.attackWeightHome,
    attackWeightAway: full.attackWeightAway,
    defenseWeightHome: full.defenseWeightHome,
    defenseWeightAway: full.defenseWeightAway,
    totalAdvantage: full.totalAdvantage,
    totalAdvantageValue: full.totalAdvantageValue,
    homeWeight: full.homeWeight,
    awayWeight: full.awayWeight,
    goalDiffHome: full.goalDiffHome,
    goalDiffAway: full.goalDiffAway,
    totalGoalsExpect: full.totalGoalsExpect,
    totalGoalsValue: full.totalGoalsValue,
    homeWinExpect: full.homeWinExpect,
    homeWinValue: full.homeWinValue,
    totalAdvantage2: full.totalAdvantage2,
    totalAdvantage2Value: full.totalAdvantage2Value,
    goalCount: full.goalCount,
    goalCountValue: full.goalCountValue,
    verifyResult: full.verifyResult,
    verifyValue: full.verifyValue,
    ladderLabel: full.ladderLabel,
    resonance: full.resonance.verdict,
    suggestion: full.suggestion
  };
  console.log(JSON.stringify(summary, null, 2));

  // 7. 缓存测试
  console.log('\n[8] 缓存测试...');
  const cache = gs.readCache();
  const cachedKeys = Object.keys(cache);
  console.log('  缓存中有', cachedKeys.length, '个日期:', cachedKeys);
  
  console.log('\n✅ 链路验证通过！');
}

test().catch(e => { console.error('❌ 测试失败:', e.message); console.error(e.stack); });
