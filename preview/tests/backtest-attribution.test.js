const fs = require('fs');
const path = require('path');

const BACKTEST = path.join(__dirname, '..', 'js', 'pages', 'backtest.js');

function src(file) {
  return fs.readFileSync(file, 'utf8');
}

describe('M7 回测页赛后归因合同', () => {
  const code = src(BACKTEST);

  it('回测筛选包含分歧类型和归因标签', () => {
    expect(code).toContain('dd-btConflict');
    expect(code).toContain('dd-btAttribution');
    expect(code).toContain('conflictType: f.conflictType');
    expect(code).toContain('attributionTag: f.attributionTag');
  });

  it('PK 快照展示快照状态、分歧类型和归因标签', () => {
    expect(code).toContain('pk_snapshot_status');
    expect(code).toContain('pk_conflict_type');
    expect(code).toContain('pk_attribution_tags');
    expect(code).toContain('归因标签');
    expect(code).toContain('分歧类型');
  });

  it('归因标签样式存在', () => {
    expect(code).toContain('bt-pk-chip attr');
    expect(code).toContain('.bt-pk-chip.attr');
  });
});
