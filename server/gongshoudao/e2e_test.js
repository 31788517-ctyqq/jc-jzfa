/**
 * 端到端测试：从 API → 计算 → 弹窗数据
 */
const index = require('./index');

async function run() {
  console.log('=== 功守道端到端测试 ===\n');
  
  // 直接测试硬编码的 API 数据（已验证 26058=42场）
  const rawList = require('./_sample_data.json');
  
  if (!rawList || rawList.length === 0) {
    console.log('样本数据为空，请先运行 _gen_sample.js');
    return;
  }
  
  const count = Math.min(3, rawList.length);
  console.log('测试前', count, '场比赛\n');
  
  for (let i = 0; i < count; i++) {
    const raw = rawList[i];
    const matchInfo = {
      matchId: 'sample_' + i,
      homeName: raw.homeTeam || ('主队' + i),
      visitName: raw.guestTeam || ('客队' + i),
      leagueName: raw.gameShortName || '',
      num: (raw.lineId || ''),
      startTime: raw.matchTimeStr || ''
    };
    
    console.log('---', matchInfo.homeName, 'vs', matchInfo.visitName, '(' + matchInfo.leagueName + ') ---');
    
    const result = index.computeSingleMatch(raw, matchInfo);
    if (!result) {
      console.log('  计算失败\n');
      continue;
    }
    
    console.log('  进攻:', result.attackAdvantage, '| 防守:', result.defenseAdvantage);
    console.log('  格局:', result.attackPattern, '| 综合:', result.totalAdvantage);
    console.log('  阶梯:', result.ladderLabel);
    console.log('  主客权重:', result.homeWeight, 'vs', result.awayWeight);
    console.log('  总进球期望:', result.totalGoalsExpect, '| xG:', (result.homeWinExpect||'N/A'));
    console.log('  Anchor:', (result.anchor||{}).label||'N/A');
    console.log('  7场:', result.verifyResult);
    console.log('  共振:', result.resonance ? result.resonance.verdict : 'N/A');
    console.log();
  }
  
  console.log('✅ 端到端测试完成！');
}

run().catch(e => { console.error('❌', e.message); });
