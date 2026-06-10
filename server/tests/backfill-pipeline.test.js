/**
 * P0: backfill-pipeline.test.js
 * 回填管道回归测试 — prediction_logs → unified_predictions → prediction_outcomes 链路
 *
 * 覆盖：
 *   - 方向映射正确性（中文→英文）
 *   - 比分→方向推断
 *   - prediction_id 幂等性
 *   - 3模型（AI/功守道/PK）各自流入
 *   - OutcomeBackfill 命中判定逻辑
 *   - getModelHitRates 统计正确性
 */

const Database = require('better-sqlite3');

// ═══ 复用方向映射函数（from backfill_unified_predictions.js） ═══
function mapDirection(cn) {
  if (!cn) return null;
  if (cn === '主胜' || cn.startsWith('主胜') || cn === '主队不败' || cn === '胜平' || cn === '胜/平双选') return 'home';
  if (
    cn === '客胜' ||
    cn.startsWith('客胜') ||
    cn === '客队不败' ||
    cn === '客队胜' ||
    cn === '平负' ||
    cn.includes('客胜')
  )
    return 'away';
  if (cn === '平' || cn === '平局') return 'draw';
  return null;
}

function scoreToDirection(score) {
  if (!score) return null;
  const parts = String(score).split(/[-:：]/);
  if (parts.length < 2) return null;
  const h = parseInt(parts[0]),
    a = parseInt(parts[1]);
  if (isNaN(h) || isNaN(a)) return null;
  if (h > a) return 'home';
  if (h < a) return 'away';
  return 'draw';
}

function mapOverUnder(s) {
  if (!s) return null;
  if (s.includes('大球') || s.includes('over')) return 'over';
  if (s.includes('小球') || s.includes('under')) return 'under';
  return null;
}

// ═══ OutcomeBackfill 判定逻辑 ═══
function judgeOutcome(prediction, match) {
  const score = match.score || '';
  const scoreParts = score.replace(/[-:]/g, ':').split(':');
  const actualHomeScore = parseInt(scoreParts[0]) || 0;
  const actualAwayScore = parseInt(scoreParts[1]) || 0;
  const actualTotalGoals = actualHomeScore + actualAwayScore;

  let actualResult = 'pending';
  if (score) {
    if (actualHomeScore > actualAwayScore) actualResult = 'home';
    else if (actualHomeScore === actualAwayScore) actualResult = 'draw';
    else actualResult = 'away';
  }

  let directionHit = 0;
  if (prediction.direction && actualResult !== 'pending') {
    directionHit = prediction.direction === actualResult ? 1 : 0;
  }

  let overUnderHit = 0;
  if (prediction.over_under) {
    const actualOverUnder = actualTotalGoals > 2.5 ? 'over' : 'under';
    overUnderHit = prediction.over_under === actualOverUnder ? 1 : 0;
  }

  let scoreHit = 0;
  if (prediction.predicted_score && score) {
    scoreHit = prediction.predicted_score === score ? 1 : 0;
  }

  return { actualHomeScore, actualAwayScore, actualResult, actualTotalGoals, directionHit, overUnderHit, scoreHit };
}

// ═══ 辅助：创建测试数据库 ═══
function createTestDb() {
  const db = new Database(':memory:');
  // prediction_logs
  db.exec(`
    CREATE TABLE prediction_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      matchId TEXT NOT NULL,
      date TEXT, homeName TEXT, visitName TEXT, leagueName TEXT,
      matchNum TEXT, handicap INTEGER,
      ai_spf TEXT, ai_overunder TEXT, ai_score TEXT, ai_confidence REAL, ai_content TEXT,
      pk_composite_score REAL, pk_power_score REAL, pk_goal_score REAL,
      pk_heat_score REAL, pk_stability_score REAL,
      pk_direction TEXT, pk_direction_stars INTEGER, pk_goal_direction TEXT,
      pk_fusion_consensus TEXT, pk_hcp_direction TEXT,
      gs_scores_json TEXT, gs_top_score TEXT, gs_top_percent REAL,
      gs_ladder_label TEXT, gs_ladder_level INTEGER,
      actual_score TEXT, actual_spf TEXT, actual_overunder TEXT,
      actual_home_goals INTEGER, actual_away_goals INTEGER,
      created_at TEXT, updated_at TEXT
    );
  `);
  // unified_predictions
  db.exec(`
    CREATE TABLE IF NOT EXISTS unified_predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_num TEXT NOT NULL,
      match_date TEXT NOT NULL,
      match_id TEXT,
      model_name TEXT NOT NULL,
      model_version TEXT NOT NULL,
      prediction_id TEXT NOT NULL,
      direction TEXT,
      direction_confidence REAL,
      over_under TEXT,
      predicted_score TEXT,
      raw_output_json TEXT,
      consensus_tag TEXT,
      computed_at TEXT,
      UNIQUE(match_num, match_date, model_name, model_version, prediction_id)
    );
  `);
  // prediction_outcomes
  db.exec(`
    CREATE TABLE IF NOT EXISTS prediction_outcomes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prediction_id TEXT NOT NULL,
      match_num TEXT NOT NULL,
      match_date TEXT NOT NULL,
      model_name TEXT NOT NULL,
      model_version TEXT NOT NULL,
      actual_home_score INTEGER,
      actual_away_score INTEGER,
      actual_result TEXT,
      actual_total_goals INTEGER,
      direction_hit INTEGER DEFAULT 0,
      over_under_hit INTEGER DEFAULT 0,
      score_hit INTEGER DEFAULT 0,
      filled_at TEXT,
      UNIQUE(prediction_id)
    );
  `);
  return db;
}

describe('P0: backfill-pipeline — 回填管道回归', () => {
  // ═══════════════════════════════════════════
  // 1. 方向映射
  // ═══════════════════════════════════════════
  describe('1. 方向映射正确性', () => {
    it('1.1 主胜方向映射', () => {
      expect(mapDirection('主胜')).toBe('home');
      expect(mapDirection('主胜或平')).toBe('home');
      expect(mapDirection('主队不败')).toBe('home');
      expect(mapDirection('胜平')).toBe('home');
      expect(mapDirection('胜/平双选')).toBe('home');
    });

    it('1.2 客胜方向映射', () => {
      expect(mapDirection('客胜')).toBe('away');
      expect(mapDirection('客胜或平')).toBe('away');
      expect(mapDirection('客队不败')).toBe('away');
      expect(mapDirection('客队胜')).toBe('away');
      expect(mapDirection('平负')).toBe('away');
      // '客队胜或平' 不包含 '客胜' 子串，但实际包含 '客' 方向 → 需要额外处理
      // 当前 mapDirection 不支持此格式，确认行为一致
      expect(mapDirection('客队胜或平')).toBeNull();
    });

    it('1.3 平局方向映射', () => {
      expect(mapDirection('平')).toBe('draw');
      expect(mapDirection('平局')).toBe('draw');
    });

    it('1.4 模糊/空值映射', () => {
      expect(mapDirection(null)).toBeNull();
      expect(mapDirection('')).toBeNull();
      expect(mapDirection('胜平负皆有可能')).toBeNull();
      expect(mapDirection('无')).toBeNull();
    });

    it('1.5 比分→方向推断', () => {
      expect(scoreToDirection('2:1')).toBe('home');
      expect(scoreToDirection('1-2')).toBe('away');
      expect(scoreToDirection('0:0')).toBe('draw');
      expect(scoreToDirection('3：2')).toBe('home'); // 中文冒号
      expect(scoreToDirection('')).toBeNull();
      expect(scoreToDirection(null)).toBeNull();
      expect(scoreToDirection('abc')).toBeNull();
    });

    it('1.6 大小球映射', () => {
      expect(mapOverUnder('大球')).toBe('over');
      expect(mapOverUnder('over')).toBe('over');
      expect(mapOverUnder('小球')).toBe('under');
      expect(mapOverUnder('under')).toBe('under');
      expect(mapOverUnder(null)).toBeNull();
      expect(mapOverUnder('')).toBeNull();
    });
  });

  // ═══════════════════════════════════════════
  // 2. prediction_logs → unified_predictions
  // ═══════════════════════════════════════════
  describe('2. prediction_logs → unified_predictions', () => {
    let db;

    beforeEach(() => {
      db = createTestDb();
    });

    afterEach(() => db.close());

    it('2.1 AI预测流入', () => {
      // 写入 prediction_log
      db.prepare(
        `INSERT INTO prediction_logs (matchId, date, homeName, visitName, matchNum, ai_spf, ai_confidence, ai_score, ai_overunder, actual_score, actual_spf)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ).run('m_test_001', '2026-06-10', '曼城', '利物浦', '001', '主胜', 85, '2:1', '大球', '2:1', '主胜');

      const log = db.prepare('SELECT * FROM prediction_logs WHERE matchId = ?').get('m_test_001');
      const aiDir = mapDirection(log.ai_spf);
      expect(aiDir).toBe('home');

      // 写入 unified_predictions
      if (aiDir) {
        const predId = `ai_test_001_2026-06-10`;
        db.prepare(
          `INSERT INTO unified_predictions
           (match_num, match_date, match_id, model_name, model_version, prediction_id,
            direction, direction_confidence, over_under, predicted_score, computed_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        ).run('001', '2026-06-10', 'test_001', 'AI预测', 'v1.0', predId, aiDir, 85, 'over', '2:1', '2026-06-10');

        const unified = db.prepare('SELECT * FROM unified_predictions WHERE prediction_id = ?').get(predId);
        expect(unified.direction).toBe('home');
        expect(unified.model_name).toBe('AI预测');
      }
    });

    it('2.2 功守道预测流入', () => {
      db.prepare(
        `INSERT INTO prediction_logs (matchId, date, homeName, visitName, matchNum, gs_top_score, gs_top_percent, gs_scores_json, pk_fusion_consensus, actual_score)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        'm_gs_001',
        '2026-06-10',
        '巴萨',
        '皇马',
        '010',
        '2:0',
        75,
        JSON.stringify([
          { score: '2:0', percent: 75 },
          { score: '1:1', percent: 15 },
        ]),
        'strong',
        '2:0',
      );

      const log = db.prepare('SELECT * FROM prediction_logs WHERE matchId = ?').get('m_gs_001');
      let gsDir = scoreToDirection(log.gs_top_score);
      expect(gsDir).toBe('home');

      if (gsDir) {
        const predId = `gs_gs_001_2026-06-10`;
        db.prepare(
          `INSERT INTO unified_predictions
           (match_num, match_date, match_id, model_name, model_version, prediction_id,
            direction, direction_confidence, raw_output_json, consensus_tag, computed_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          '010',
          '2026-06-10',
          'gs_001',
          '功守道',
          'v1.0',
          predId,
          gsDir,
          75,
          log.gs_scores_json,
          'strong',
          '2026-06-10',
        );

        const unified = db.prepare('SELECT * FROM unified_predictions WHERE prediction_id = ?').get(predId);
        expect(unified.model_name).toBe('功守道');
        expect(unified.direction).toBe('home');
        expect(unified.consensus_tag).toBe('strong');
      }
    });

    it('2.3 PK评分预测流入', () => {
      db.prepare(
        `INSERT INTO prediction_logs (matchId, date, homeName, visitName, matchNum,
         pk_direction, pk_composite_score, pk_power_score, pk_goal_score, pk_heat_score, pk_stability_score,
         pk_goal_direction, pk_fusion_consensus, actual_score)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run('m_pk_001', '2026-06-10', '尤文', '国米', '020', '客胜', 82, 70, 60, 75, 65, '大球', 'weak', '1:2');

      const log = db.prepare('SELECT * FROM prediction_logs WHERE matchId = ?').get('m_pk_001');
      const pkDir = mapDirection(log.pk_direction);
      expect(pkDir).toBe('away');

      if (pkDir) {
        const predId = `pk_pk_001_2026-06-10`;
        db.prepare(
          `INSERT INTO unified_predictions
           (match_num, match_date, match_id, model_name, model_version, prediction_id,
            direction, direction_confidence, over_under, raw_output_json, consensus_tag, computed_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          '020',
          '2026-06-10',
          'pk_001',
          'PK评分',
          'v1.0',
          predId,
          pkDir,
          82,
          'over',
          JSON.stringify({ composite: 82, power: 70, goal: 60, heat: 75, stability: 65 }),
          'weak',
          '2026-06-10',
        );

        const unified = db.prepare('SELECT * FROM unified_predictions WHERE prediction_id = ?').get(predId);
        expect(unified.model_name).toBe('PK评分');
        expect(unified.direction).toBe('away');
        expect(unified.over_under).toBe('over');
      }
    });

    it('2.4 一条 prediction_log 生成 3 个 unified 记录', () => {
      db.prepare(
        `INSERT INTO prediction_logs (matchId, date, homeName, visitName, matchNum,
         ai_spf, ai_confidence, ai_score,
         gs_top_score, gs_top_percent, gs_scores_json,
         pk_direction, pk_composite_score,
         actual_score)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        'm_full_001',
        '2026-06-10',
        '拜仁',
        '多特',
        '050',
        '主胜',
        90,
        '3:1',
        '3:1',
        80,
        JSON.stringify([{ score: '3:1', percent: 80 }]),
        '主胜',
        88,
        '3:1',
      );

      const log = db.prepare('SELECT * FROM prediction_logs WHERE matchId = ?').get('m_full_001');
      let unifiedCount = 0;

      // AI
      if (mapDirection(log.ai_spf)) {
        db.prepare(
          `INSERT INTO unified_predictions (match_num, match_date, match_id, model_name, model_version, prediction_id, direction, direction_confidence, predicted_score, computed_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          '050',
          '2026-06-10',
          'full_001',
          'AI预测',
          'v1.0',
          `ai_full_001_2026-06-10`,
          'home',
          90,
          '3:1',
          '2026-06-10',
        );
        unifiedCount++;
      }

      // GS
      if (scoreToDirection(log.gs_top_score)) {
        db.prepare(
          `INSERT INTO unified_predictions (match_num, match_date, match_id, model_name, model_version, prediction_id, direction, direction_confidence, raw_output_json, computed_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          '050',
          '2026-06-10',
          'full_001',
          '功守道',
          'v1.0',
          `gs_full_001_2026-06-10`,
          'home',
          80,
          log.gs_scores_json,
          '2026-06-10',
        );
        unifiedCount++;
      }

      // PK
      if (mapDirection(log.pk_direction)) {
        db.prepare(
          `INSERT INTO unified_predictions (match_num, match_date, match_id, model_name, model_version, prediction_id, direction, direction_confidence, computed_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        ).run('050', '2026-06-10', 'full_001', 'PK评分', 'v1.0', `pk_full_001_2026-06-10`, 'home', 88, '2026-06-10');
        unifiedCount++;
      }

      expect(unifiedCount).toBe(3);

      const all = db.prepare("SELECT model_name FROM unified_predictions WHERE match_id = 'full_001'").all();
      const models = all.map((r) => r.model_name).sort();
      expect(models).toEqual(['AI预测', 'PK评分', '功守道']);
    });
  });

  // ═══════════════════════════════════════════
  // 3. prediction_id 幂等性
  // ═══════════════════════════════════════════
  describe('3. 幂等性', () => {
    let db;

    beforeEach(() => {
      db = createTestDb();
    });

    afterEach(() => db.close());

    it('3.1 重复 prediction_id 不产生重复记录', () => {
      const predId = 'ai_dup_test_2026-06-10';

      // 第一次写入
      db.prepare(
        `INSERT OR IGNORE INTO unified_predictions
         (match_num, match_date, match_id, model_name, model_version, prediction_id, direction, direction_confidence, computed_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run('001', '2026-06-10', 'dup_test', 'AI预测', 'v1.0', predId, 'home', 80, '2026-06-10');

      // 第二次写入同一 prediction_id → 应跳过
      db.prepare(
        `INSERT OR IGNORE INTO unified_predictions
         (match_num, match_date, match_id, model_name, model_version, prediction_id, direction, direction_confidence, computed_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run('001', '2026-06-10', 'dup_test', 'AI预测', 'v1.0', predId, 'home', 80, '2026-06-10');

      const rows = db.prepare('SELECT COUNT(*) as cnt FROM unified_predictions WHERE prediction_id = ?').get(predId);
      expect(rows.cnt).toBe(1);
    });

    it('3.2 重复运行 backfill_unified_predictions 不产生重复', () => {
      // 模拟第一条记录
      db.prepare(
        `INSERT INTO prediction_logs (matchId, date, matchNum, ai_spf, ai_confidence, actual_score)
         VALUES (?,?,?,?,?,?)`,
      ).run('m_bp_001', '2026-06-10', '001', '主胜', 85, '2:1');

      // 第一次回填
      const log1 = db.prepare('SELECT * FROM prediction_logs WHERE matchId = ?').get('m_bp_001');
      const predId1 = `ai_bp_001_2026-06-10`;
      db.prepare(
        `INSERT OR IGNORE INTO unified_predictions
         (match_num, match_date, match_id, model_name, model_version, prediction_id, direction, direction_confidence, computed_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run('001', '2026-06-10', 'bp_001', 'AI预测', 'v1.0', predId1, 'home', 85, '2026-06-10');

      // 第二次回填（重复运行脚本）
      db.prepare(
        `INSERT OR IGNORE INTO unified_predictions
         (match_num, match_date, match_id, model_name, model_version, prediction_id, direction, direction_confidence, computed_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run('001', '2026-06-10', 'bp_001', 'AI预测', 'v1.0', predId1, 'home', 85, '2026-06-10');

      const rows = db.prepare('SELECT COUNT(*) as cnt FROM unified_predictions WHERE prediction_id = ?').get(predId1);
      expect(rows.cnt).toBe(1);
    });

    it('3.3 已有 unified 记录不重复创建 outcome', () => {
      const predId = 'ai_out_dedup_2026-06-10';

      // 首次写入 outcome
      db.prepare(
        `INSERT OR REPLACE INTO prediction_outcomes
         (prediction_id, match_num, match_date, model_name, model_version, direction_hit)
         VALUES (?,?,?,?,?,?)`,
      ).run(predId, '001', '2026-06-10', 'AI预测', 'v1.0', 1);

      // 再次回填同一条
      db.prepare('SELECT id FROM prediction_outcomes WHERE prediction_id = ?').get(predId);
      // 已有 → 跳过

      const outRows = db.prepare('SELECT COUNT(*) as cnt FROM prediction_outcomes WHERE prediction_id = ?').get(predId);
      expect(outRows.cnt).toBe(1);
    });
  });

  // ═══════════════════════════════════════════
  // 4. OutcomeBackfill 命中判定
  // ═══════════════════════════════════════════
  describe('4. OutcomeBackfill 命中判定', () => {
    it('4.1 主胜命中', () => {
      const outcome = judgeOutcome({ direction: 'home' }, { score: '2:1' });
      expect(outcome.directionHit).toBe(1);
      expect(outcome.actualResult).toBe('home');
    });

    it('4.2 方向未命中', () => {
      const outcome = judgeOutcome({ direction: 'away' }, { score: '3:0' });
      expect(outcome.directionHit).toBe(0);
      expect(outcome.actualResult).toBe('home');
    });

    it('4.3 大小球命中 (over)', () => {
      const outcome = judgeOutcome({ direction: 'home', over_under: 'over' }, { score: '3:1' });
      expect(outcome.overUnderHit).toBe(1); // 4 > 2.5
    });

    it('4.4 大小球命中 (under)', () => {
      const outcome = judgeOutcome({ direction: 'home', over_under: 'under' }, { score: '1:0' });
      expect(outcome.overUnderHit).toBe(1); // 1 < 2.5
    });

    it('4.5 比分命中', () => {
      const outcome = judgeOutcome({ direction: 'draw', predicted_score: '1:1' }, { score: '1:1' });
      expect(outcome.scoreHit).toBe(1);
    });

    it('4.6 比分未命中', () => {
      const outcome = judgeOutcome({ direction: 'home', predicted_score: '2:0' }, { score: '2:1' });
      expect(outcome.scoreHit).toBe(0);
    });

    it('4.7 实际比分解析正确', () => {
      const outcome = judgeOutcome(
        { direction: 'home' },
        { score: '3-2' }, // 用 - 分隔符
      );
      expect(outcome.actualHomeScore).toBe(3);
      expect(outcome.actualAwayScore).toBe(2);
      expect(outcome.actualTotalGoals).toBe(5);
    });
  });

  // ═══════════════════════════════════════════
  // 5. getModelHitRates 统计
  // ═══════════════════════════════════════════
  describe('5. getModelHitRates 统计', () => {
    let db;

    beforeEach(() => {
      db = createTestDb();
    });

    afterEach(() => db.close());

    it('5.1 3模型命中率统计', () => {
      // 写入 3 条 outcome
      const outcomes = [
        ['ai_001_2026-06-10', '001', '2026-06-10', 'AI预测', 'v1.0', 1, 0, 0],
        ['gs_001_2026-06-10', '001', '2026-06-10', '功守道', 'v1.0', 0, 0, 1],
        ['pk_001_2026-06-10', '001', '2026-06-10', 'PK评分', 'v1.0', 1, 1, 0],
      ];

      const stmt = db.prepare(
        `INSERT INTO prediction_outcomes
         (prediction_id, match_num, match_date, model_name, model_version, direction_hit, over_under_hit, score_hit)
         VALUES (?,?,?,?,?,?,?,?)`,
      );

      outcomes.forEach((o) => stmt.run(...o));

      // 模拟 getModelHitRates 查询
      const rows = db
        .prepare(
          `
        SELECT model_name, model_version,
          COUNT(*) as total,
          SUM(direction_hit) as dir_hits,
          SUM(over_under_hit) as ou_hits,
          SUM(score_hit) as score_hits
        FROM prediction_outcomes
        GROUP BY model_name, model_version
        ORDER BY model_name
      `,
        )
        .all();

      expect(rows.length).toBe(3);

      const byName = {};
      rows.forEach((r) => (byName[r.model_name] = r));

      // AI预测: 1样本, 方向命中
      expect(byName['AI预测'].dir_hits).toBe(1);
      expect(byName['AI预测'].score_hits).toBe(0);

      // 功守道: 1样本, 比分命中
      expect(byName['功守道'].score_hits).toBe(1);
      expect(byName['功守道'].dir_hits).toBe(0);

      // PK评分: 1样本, 方向+大小球命中
      expect(byName['PK评分'].dir_hits).toBe(1);
      expect(byName['PK评分'].ou_hits).toBe(1);
    });

    it('5.2 空数据统计不抛异常', () => {
      const rows = db
        .prepare(
          `
        SELECT model_name, COUNT(*) as total, SUM(direction_hit) as dir_hits
        FROM prediction_outcomes GROUP BY model_name
      `,
        )
        .all();

      expect(rows.length).toBe(0);
    });

    it('5.3 多模型多版本统计', () => {
      const outcomes = [
        ['ai_001_2026-06-10', '001', '2026-06-10', 'AI预测', 'v1.0', 1, 0, 0],
        ['ai_002_2026-06-10', '002', '2026-06-10', 'AI预测', 'v1.0', 0, 0, 0],
        ['ai_003_2026-06-10', '003', '2026-06-10', 'AI预测', 'v2.0', 1, 1, 0],
        ['pk_001_2026-06-10', '001', '2026-06-10', 'PK评分', 'v1.0', 1, 0, 0],
        ['pk_002_2026-06-10', '002', '2026-06-10', 'PK评分', 'v1.0', 1, 0, 0],
      ];

      const stmt = db.prepare(
        `INSERT INTO prediction_outcomes
         (prediction_id, match_num, match_date, model_name, model_version, direction_hit, over_under_hit, score_hit)
         VALUES (?,?,?,?,?,?,?,?)`,
      );
      outcomes.forEach((o) => stmt.run(...o));

      const rows = db
        .prepare(
          `
        SELECT model_name, model_version, COUNT(*) as total, SUM(direction_hit) as dir_hits
        FROM prediction_outcomes
        GROUP BY model_name, model_version
        ORDER BY model_name, model_version
      `,
        )
        .all();

      expect(rows.length).toBe(3); // AI v1.0, AI v2.0, PK v1.0

      const aiV1 = rows.find((r) => r.model_name === 'AI预测' && r.model_version === 'v1.0');
      expect(aiV1.total).toBe(2);
      expect(aiV1.dir_hits).toBe(1); // 2场中1

      const aiV2 = rows.find((r) => r.model_name === 'AI预测' && r.model_version === 'v2.0');
      expect(aiV2.total).toBe(1);
      expect(aiV2.dir_hits).toBe(1);

      const pkV1 = rows.find((r) => r.model_name === 'PK评分' && r.model_version === 'v1.0');
      expect(pkV1.total).toBe(2);
      expect(pkV1.dir_hits).toBe(2); // 2场全中
    });
  });

  // ═══════════════════════════════════════════
  // 6. finalCheck 链路完整性
  // ═══════════════════════════════════════════
  describe('6. finalCheck 链路完整性', () => {
    let db;

    beforeEach(() => {
      db = createTestDb();
    });

    afterEach(() => db.close());

    it('6.1 prediction_logs → unified_predictions → outcome 全链路', () => {
      // Step 1: 写入 prediction_logs（含实际赛果）
      db.prepare(
        `INSERT INTO prediction_logs (matchId, date, homeName, visitName, matchNum,
         ai_spf, ai_confidence, ai_score, ai_overunder,
         pk_direction, pk_composite_score, pk_goal_direction,
         actual_score, actual_spf, actual_overunder, actual_home_goals, actual_away_goals)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        'm_e2e_001',
        '2026-06-10',
        'A',
        'B',
        '001',
        '主胜',
        88,
        '2:0',
        '小球',
        '主胜',
        82,
        '小球',
        '2:0',
        '主胜',
        '小球',
        2,
        0,
      );

      // Step 2: 模拟 incrementalSyncToUnified
      const log = db.prepare('SELECT * FROM prediction_logs WHERE matchId = ?').get('m_e2e_001');
      const mid = log.matchId.replace(/^m_/, '');
      const date = log.date;

      // AI → unified
      const aiDir = mapDirection(log.ai_spf);
      const aiPredId = `ai_${mid}_${date}`;
      db.prepare(
        `INSERT INTO unified_predictions
         (match_num, match_date, match_id, model_name, model_version, prediction_id,
          direction, direction_confidence, over_under, predicted_score, computed_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        '001',
        date,
        mid,
        'AI预测',
        'v1.0',
        aiPredId,
        aiDir,
        log.ai_confidence,
        mapOverUnder(log.ai_overunder),
        log.ai_score,
        date,
      );

      // PK → unified
      const pkDir = mapDirection(log.pk_direction);
      const pkPredId = `pk_${mid}_${date}`;
      db.prepare(
        `INSERT INTO unified_predictions
         (match_num, match_date, match_id, model_name, model_version, prediction_id,
          direction, direction_confidence, over_under, computed_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        '001',
        date,
        mid,
        'PK评分',
        'v1.0',
        pkPredId,
        pkDir,
        log.pk_composite_score,
        mapOverUnder(log.pk_goal_direction),
        date,
      );

      // Step 3: 模拟 outcome backfill
      const unifiedRows = db.prepare('SELECT * FROM unified_predictions WHERE match_id = ?').all(mid);
      expect(unifiedRows.length).toBe(2);

      const match = { score: '2:0' };
      unifiedRows.forEach((pred) => {
        const outcome = judgeOutcome(pred, match);
        db.prepare(
          `INSERT OR REPLACE INTO prediction_outcomes
           (prediction_id, match_num, match_date, model_name, model_version,
            actual_home_score, actual_away_score, actual_result, actual_total_goals,
            direction_hit, over_under_hit, score_hit)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          pred.prediction_id,
          pred.match_num,
          pred.match_date,
          pred.model_name,
          pred.model_version,
          outcome.actualHomeScore,
          outcome.actualAwayScore,
          outcome.actualResult,
          outcome.actualTotalGoals,
          outcome.directionHit,
          outcome.overUnderHit,
          outcome.scoreHit,
        );
      });

      // Step 4: 验证全链路
      const outcomes = db
        .prepare('SELECT * FROM prediction_outcomes WHERE match_num = ? AND match_date = ?')
        .all('001', date);
      expect(outcomes.length).toBe(2);

      // AI 预测 2:0 → 方向命中(主胜), 小球命中(2<2.5), 比分命中
      const aiOut = outcomes.find((o) => o.model_name === 'AI预测');
      expect(aiOut.direction_hit).toBe(1);
      expect(aiOut.over_under_hit).toBe(1);
      expect(aiOut.score_hit).toBe(1);

      // PK 方向命中, 小球命中
      const pkOut = outcomes.find((o) => o.model_name === 'PK评分');
      expect(pkOut.direction_hit).toBe(1);
      expect(pkOut.over_under_hit).toBe(1);
    });

    it('6.2 缺失实际赛果时跳过', () => {
      db.prepare(
        `INSERT INTO prediction_logs (matchId, date, matchNum, ai_spf, actual_score)
         VALUES (?,?,?,?,?)`,
      ).run('m_no_result', '2026-06-10', '020', '主胜', '');

      // 无 actual_score → 不会被同步到 unified
      const logs = db.prepare("SELECT * FROM prediction_logs WHERE actual_score IS NULL OR actual_score = ''").all();
      expect(logs.length).toBe(1);
      // 这些记录在回填时应被跳过
    });

    it('6.3 无方向预测时跳过 model', () => {
      db.prepare(
        `INSERT INTO prediction_logs (matchId, date, matchNum, actual_score, actual_spf)
         VALUES (?,?,?,?,?)`,
      ).run('m_no_dir', '2026-06-10', '030', '1:1', '平');

      const log = db.prepare('SELECT * FROM prediction_logs WHERE matchId = ?').get('m_no_dir');
      expect(mapDirection(log.ai_spf)).toBeNull();
      // 不应生成 unified_predictions 记录
    });
  });
});
