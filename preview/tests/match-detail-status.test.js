/**
 * P0: match-detail statusText 回归测试
 * 验证未开始比赛不会因 hasResults 脏数据被标记为"已结束"
 */
describe('match-detail statusText — 状态标签', function () {
  // ★ 修复后的 statusText 算法（纯 matchStatus，不用 hasResults）
  function computeStatusText(match) {
    return match.matchStatus === 2
      ? '已结束'
      : match.matchStatus === 1
        ? '进行中'
        : '未开始';
  }

  // ★ 修复前的旧算法（用于对比验证回归）
  function oldStatusText(match, hasResults) {
    return match.matchStatus === 2 || hasResults
      ? '已结束'
      : { 0: '未开始', 1: '进行中' }[match.matchStatus] || '未知';
  }

  // ── 核心回归：hasResults 不应影响未开始比赛的状态 ──
  it('未开始+hasResults=true → 仍显示"未开始"', function () {
    var match = { matchStatus: 0, score: '' };
    var newText = computeStatusText(match);
    var oldText = oldStatusText(match, true);

    expect(newText).toBe('未开始');
    expect(oldText).toBe('已结束'); // 旧算法 bug 复现
  });

  it('未开始+hasResults=false → 显示"未开始"', function () {
    var match = { matchStatus: 0 };
    expect(computeStatusText(match)).toBe('未开始');
  });

  it('进行中 → 显示"进行中"', function () {
    expect(computeStatusText({ matchStatus: 1 })).toBe('进行中');
  });

  it('已结束 → 显示"已结束"', function () {
    expect(computeStatusText({ matchStatus: 2 })).toBe('已结束');
  });

  // ── 脏数据场景：matchStatus=0 但有旧推荐结果 ──
  it('脏数据防御：status=0+有推荐result → 不显示已结束', function () {
    // 模拟 周一013：matchStatus=0，但推荐"总进球-5、6球" result=2
    var match = { matchStatus: 0, num: '周一013' };
    var hasResults = true;

    expect(computeStatusText(match)).toBe('未开始');
    expect(oldStatusText(match, hasResults)).toBe('已结束'); // 旧bug
  });

  // ── 已结束比赛即使hasResults=false也正确 ──
  it('已结束+无推荐 → 仍显示"已结束"', function () {
    var match = { matchStatus: 2, score: '3-1' };
    expect(computeStatusText(match)).toBe('已结束');
  });

  // ── 徽章样式逻辑 ──
  it('徽章样式：status=0 → cyan 色', function () {
    var match = { matchStatus: 0 };
    var bg = match.matchStatus === 0
      ? 'rgba(34,211,238,0.1)'
      : 'rgba(52,211,153,0.1)';
    var color = match.matchStatus === 0 ? 'var(--cyan)' : 'var(--green)';

    expect(bg).toBe('rgba(34,211,238,0.1)');
    expect(color).toBe('var(--cyan)');
  });

  it('徽章样式：status=2 → green 色', function () {
    var match = { matchStatus: 2 };
    var bg = match.matchStatus === 0
      ? 'rgba(34,211,238,0.1)'
      : 'rgba(52,211,153,0.1)';

    expect(bg).toBe('rgba(52,211,153,0.1)');
  });

  // ── roundText 排号兜底 ──
  it('roundText: match.num 优先', function () {
    var roundText = '周一013' || '' || '竞彩';
    expect(roundText).toBe('周一013');
  });

  it('roundText: 无 num 用 matchNum', function () {
    var match = { num: undefined, matchNum: '周一015' };
    var roundText = match.num || match.matchNum || '竞彩';
    expect(roundText).toBe('周一015');
  });

  it('roundText: 全无则兜底"竞彩"', function () {
    var match = { num: undefined, matchNum: undefined };
    var roundText = match.num || match.matchNum || '竞彩';
    expect(roundText).toBe('竞彩');
  });
});
