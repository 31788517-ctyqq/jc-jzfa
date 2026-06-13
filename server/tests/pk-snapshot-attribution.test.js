const fs = require('fs');
const path = require('path');

const PREDICTION_LOG = path.join(__dirname, '..', 'prediction_log.js');
const PK_SCORER = path.join(__dirname, '..', 'pk_scorer.js');
const INDEX_FILE = path.join(__dirname, '..', 'index.js');

function src(file) {
  return fs.readFileSync(file, 'utf8');
}

describe('M7 赛前快照与赛后归因合同', () => {
  const predictionLog = src(PREDICTION_LOG);
  const pkScorer = src(PK_SCORER);
  const indexSource = src(INDEX_FILE);

  it('prediction_logs 自动补齐 M7 快照与归因列', () => {
    [
      'pk_feature_snapshot_id',
      'pk_feature_snapshot_json',
      'pk_conflict_type',
      'pk_value_edge',
      'pk_expected_value',
      'pk_actual_result',
      'pk_hit_status',
      'pk_roi_result',
      'pk_attribution_tags_json',
      'pk_snapshot_status',
    ].forEach((field) => expect(predictionLog).toContain(field));
  });

  it('upsertPK 写入赛前快照和分歧/EV 字段', () => {
    expect(predictionLog).toContain('function _buildFeatureSnapshot');
    expect(predictionLog).toContain('data.pk_feature_snapshot_id');
    expect(predictionLog).toContain('data.pk_feature_snapshot_json');
    expect(predictionLog).toContain('data.pk_conflict_type');
    expect(predictionLog).toContain('data.pk_expected_value');
    expect(predictionLog).toContain("data.pk_snapshot_status = 'pre_match'");
  });

  it('backfillResult 计算赛后命中、ROI 和归因标签', () => {
    expect(predictionLog).toContain('function _buildOutcomeFields');
    expect(predictionLog).toContain('function _buildAttributionTags');
    expect(predictionLog).toContain('pk_hit_status');
    expect(predictionLog).toContain('pk_roi_result');
    expect(predictionLog).toContain('pk_attribution_tags_json');
    expect(predictionLog).toContain('pk_snapshot_status');
  });

  it('PK scorer 持久化传入 featureSnapshotId / conflictType / valueEdge / expectedValue', () => {
    expect(pkScorer).toContain('featureSnapshotId');
    expect(pkScorer).toContain('conflictType');
    expect(pkScorer).toContain('valueEdge: adv.valueEdge');
    expect(pkScorer).toContain('expectedValue: adv.expectedValue');
  });

  it('prediction-backtest 支持分歧类型和归因标签查询', () => {
    expect(predictionLog).toContain('filters.conflictType');
    expect(predictionLog).toContain('filters.attributionTag');
    expect(indexSource).toContain('conflictType: data.conflictType');
    expect(indexSource).toContain('attributionTag: data.attributionTag');
    expect(indexSource).toContain("(data.conflictType || 'all')");
    expect(indexSource).toContain("(data.attributionTag || 'all')");
  });
});
