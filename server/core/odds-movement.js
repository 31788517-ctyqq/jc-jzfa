/**
 * server/core/odds-movement.js
 * V2.0 盘口变化验证 — 初盘→即时盘位移和水位变化检测
 *
 * 增强 pk_scorer 的交叉验证维度：
 *   1. 盘口位移检测：初盘 vs 即时盘赔率变化方向
 *   2. 水位变化幅度：降水/升水判定
 *   3. 与模型方向一致性检查
 */

/**
 * 分析初盘与即时盘之间的变化
 * @param {Object} openOdds  { home: number, draw: number, away: number }
 * @param {Object} liveOdds  { home: number, draw: number, away: number }
 * @param {number} pwScore  模型实力方向（>0 看好主队, <0 看好客队）
 * @returns {{ direction: string, severity: string, penalty: number, waterChange: number,
 *             openHomeWinProb: number, liveHomeWinProb: number, probShift: number }}
 */
function analyzeMovement(openOdds, liveOdds, pwScore) {
  var result = {
    direction: '盘口稳定',
    severity: 'none',
    penalty: 0,
    waterChange: 0,
    openHomeWinProb: 0,
    liveHomeWinProb: 0,
    probShift: 0,
  };

  // 参数验证
  if (!openOdds || !liveOdds) return result;
  var oHome = parseFloat(openOdds.home) || 0;
  var oDraw = parseFloat(openOdds.draw) || 0;
  var oAway = parseFloat(openOdds.away) || 0;
  var lHome = parseFloat(liveOdds.home) || 0;
  var lDraw = parseFloat(liveOdds.draw) || 0;
  var lAway = parseFloat(liveOdds.away) || 0;

  if (oHome <= 1.0 || lHome <= 1.0) return result; // 无效赔率

  // 隐含概率（市场抽水去偏）
  function impliedProb(h, d, a) {
    var invSum = 1 / h + 1 / d + 1 / a;
    return {
      home: +(1 / h / invSum).toFixed(4),
      draw: +(1 / d / invSum).toFixed(4),
      away: +(1 / a / invSum).toFixed(4),
    };
  }

  var oProbs = impliedProb(oHome, oDraw, oAway);
  var lProbs = impliedProb(lHome, lDraw, lAway);

  result.openHomeWinProb = oProbs.home;
  result.liveHomeWinProb = lProbs.home;
  result.probShift = +(lProbs.home - oProbs.home).toFixed(4);

  // 1. 盘口方向判定
  var absShift = Math.abs(result.probShift);
  if (absShift < 0.02) {
    result.direction = '盘口稳定';
    result.waterChange = 0;
  } else if (result.probShift > 0.05) {
    result.direction = '主胜降水（市场看好主队）';
    result.waterChange = absShift;
    if (pwScore < -0.1) {
      // 模型看客胜，但盘口向主胜移动 → 矛盾
      result.penalty = 15;
      result.severity = 'significant';
    }
  } else if (result.probShift > 0.02) {
    result.direction = '主胜微降水';
    result.waterChange = absShift;
    if (pwScore < -0.08) result.penalty = 8;
    result.severity = 'moderate';
  } else if (result.probShift < -0.05) {
    result.direction = '主胜升水（市场看衰主队）';
    result.waterChange = absShift;
    if (pwScore > 0.1) {
      result.penalty = 15;
      result.severity = 'significant';
    }
  } else if (result.probShift < -0.02) {
    result.direction = '主胜微升水';
    result.waterChange = absShift;
    if (pwScore > 0.08) result.penalty = 8;
    result.severity = 'moderate';
  }

  // 2. 水位变化幅度标记
  if (absShift > 0.08) result.severity = 'significant';
  else if (absShift > 0.04) result.severity = 'moderate';
  else if (absShift > 0.02) result.severity = 'minor';
  else result.severity = 'none';

  return result;
}

/**
 * 欧亚一致性检测
 * @param {Object} openOdds 初盘欧赔 { home, draw, away }
 * @param {number} asianHandicap 亚盘让球数（正=主让,负=客让）
 * @param {number} pwScore 模型实力方向
 * @returns {{ consistent: boolean, detail: string, penalty: number }}
 */
function checkEuroAsiaConsistency(openOdds, asianHandicap, pwScore) {
  var result = { consistent: true, detail: '', penalty: 0 };
  if (!openOdds || openOdds.home <= 1.0) return result;

  var h = parseFloat(openOdds.home) || 2.0;
  var a = parseFloat(openOdds.away) || 2.0;
  var rq = parseFloat(asianHandicap) || 0;

  // 欧赔方向：赔率低=看好
  var euroFavorsHome = h < a;
  // 亚盘方向：让球方=看好
  var asianFavorsHome = rq > 0;

  if (euroFavorsHome !== asianFavorsHome) {
    result.consistent = false;
    result.detail =
      '欧亚不一致：欧赔' +
      (euroFavorsHome ? '看好主队' : '看好客队') +
      '，亚盘' +
      (asianFavorsHome ? '主让' : rq < 0 ? '客让' : '平手');
    result.penalty = 12;
  } else {
    // 一致，进一步检测与模型方向是否一致
    var marketFavorsHome = euroFavorsHome;
    if (pwScore > 0.1 && !marketFavorsHome) {
      result.penalty = 10;
      result.detail = '市场方向与模型方向不一致';
    } else if (pwScore < -0.1 && marketFavorsHome) {
      result.penalty = 10;
      result.detail = '市场方向与模型方向不一致';
    } else {
      result.detail = '欧亚一致' + (marketFavorsHome ? '（看好主队）' : '（看好客队）');
    }
  }

  return result;
}

module.exports = { analyzeMovement, checkEuroAsiaConsistency };
