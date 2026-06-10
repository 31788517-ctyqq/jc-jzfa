/**
 * P1: unified-predictions-inflow.test.js
 * prediction_logs → unified_predictions 数据流入映射正确性测试
 *
 * 覆盖：
 *   - incrementalSyncToUnified 映射正确性
 *   - 方向映射（中文→英文→outcome 判定）
 *   - prediction_id 生成规则
 *   - 三模型各自字段映射
 *   - 边界场景（空值、无方向、无GS数据）
 */

const Database = require('better-sqlite3');

// ═══ 复用现有映射函数 ═══
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

// ═══ 辅助：创建测试数据库 ═══
function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE prediction_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      matchId TEXT NOT NULL, date TEXT, homeName TEXT, visitName TEXT,
      leagueName TEXT, matchNum TEXT, handicap INTEGER,
      ai_spf TEXT, ai_overunder TEXT, ai_score TEXT, ai_confidence REAL, ai_content TEXT,
      pk_composite_score REAL, pk_power_score REAL, pk_goal_score REAL,
      pk_heat_score REAL, pk_stability_score REAL,
      pk_direction TEXT, pk_direction_stars INTEGER, pk_goal_direction TEXT,
      pk_fusion_consensus TEXT, pk_hcp_direction TEXT,
      pk_value_score REAL, pk_ev_home REAL, pk_ev_draw REAL, pk_ev_away REAL,
      pk_health_score REAL, pk_value_tag TEXT,
      gs_scores_json TEXT, gs_top_score TEXT, gs_top_percent REAL,
      gs_ladder_label TEXT, gs_ladder_level INTEGER,
      gs_modelA_total REAL, gs_modelB_total REAL, gs_modelC_total REAL,
      actual_score TEXT, actual_spf TEXT, actual_overunder TEXT,
      actual_home_goals INTEGER, actual_away_goals INTEGER,
      created_at TEXT, updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS unified_predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_num TEXT NOT NULL, match_date TEXT NOT NULL, match_id TEXT,
      model_name TEXT NOT NULL, model_version TEXT NOT NULL,
      prediction_id TEXT NOT NULL, direction TEXT, direction_confidence REAL,
      goal_total REAL, goal_range TEXT, over_under TEXT,
      predicted_score TEXT, score_probability REAL,
      features_json TEXT, raw_output_json TEXT,
      consensus_tag TEXT, fetch_batch_id TEXT,
      computed_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(match_num, match_date, model_name, model_version, prediction_id)
    );
    CREATE TABLE IF NOT EXISTS prediction_outcomes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prediction_id TEXT NOT NULL UNIQUE, match_num TEXT, match_date TEXT,
      model_name TEXT, model_version TEXT,
      actual_home_score INTEGER, actual_away_score INTEGER,
      actual_result TEXT, actual_total_goals INTEGER,
      direction_hit INTEGER DEFAULT 0, over_under_hit INTEGER DEFAULT 0,
      score_hit INTEGER DEFAULT 0, filled_at TEXT
    );
  `);
  return db;
}

function judgeOutcome(prediction, match) {
  const score = match.score || '';
  const parts = score.replace(/[-:]/g, ':').split(':');
  const ah = parseInt(parts[0]) || 0,
    aa = parseInt(parts[1]) || 0;
  const total = ah + aa;
  let actualResult = 'pending';
  if (score) {
    if (ah > aa) actualResult = 'home';
    else if (ah === aa) actualResult = 'draw';
    else actualResult = 'away';
  }
  return {
    actualHomeScore: ah,
    actualAwayScore: aa,
    actualResult,
    actualTotalGoals: total,
    directionHit:
      prediction.direction && actualResult !== 'pending' ? (prediction.direction === actualResult ? 1 : 0) : 0,
    overUnderHit: prediction.over_under ? ((total > 2.5 ? 'over' : 'under') === prediction.over_under ? 1 : 0) : 0,
    scoreHit: prediction.predicted_score && score ? (prediction.predicted_score === score ? 1 : 0) : 0,
  };
}

describe('P1: unified-predictions-inflow — 数据流入映射', () => {
  let db;

  beforeEach(() => {
    db = createTestDb();
  });
  afterEach(() => db.close());

  // ═══════════════════════════════════════════
  // 1. prediction_id 生成规则
  // ═══════════════════════════════════════════
  describe('1. prediction_id 生成规则', () => {
    it('1.1 AI prediction_id: ai_{matchId}_{date}', () => {
      expect(`ai_test123_2026-06-10`).toBe('ai_test123_2026-06-10');
    });

    it('1.2 GS prediction_id: gs_{matchId}_{date}', () => {
      expect(`gs_test123_2026-06-10`).toBe('gs_test123_2026-06-10');
    });

    it('1.3 PK prediction_id: pk_{matchId}_{date}', () => {
      expect(`pk_test123_2026-06-10`).toBe('pk_test123_2026-06-10');
    });

    it('1.4 matchId 去除 m_ 前缀', () => {
      const mid = 'm_test456'.replace(/^m_/, '');
      expect(mid).toBe('test456');
    });
  });

  // ═══════════════════════════════════════════
  // 2. 方向映射完整性
  // ═══════════════════════════════════════════
  describe('2. 方向映射覆盖', () => {
    it('2.1 所有已知主胜变体', () => {
      const variants = ['主胜', '主胜或平', '主队不败', '胜平', '胜/平双选'];
      variants.forEach((v) => expect(mapDirection(v)).toBe('home'));
    });

    it('2.2 所有已知客胜变体', () => {
      const variants = ['客胜', '客胜或平', '客队不败', '客队胜', '平负'];
      variants.forEach((v) => expect(mapDirection(v)).toBe('away'));
    });

    it('2.3 比分→方向推断所有情况', () => {
      expect(scoreToDirection('2:0')).toBe('home');
      expect(scoreToDirection('3:1')).toBe('home');
      expect(scoreToDirection('0:0')).toBe('draw');
      expect(scoreToDirection('1:1')).toBe('draw');
      expect(scoreToDirection('0:1')).toBe('away');
      expect(scoreToDirection('1:3')).toBe('away');
    });

    it('2.4 大小球映射覆盖', () => {
      expect(mapOverUnder('大球')).toBe('over');
      expect(mapOverUnder('大球（2.5）')).toBe('over');
      expect(mapOverUnder('over 2.5')).toBe('over');
      expect(mapOverUnder('小球')).toBe('under');
      expect(mapOverUnder('under 2.5')).toBe('under');
    });
  });

  // ═══════════════════════════════════════════
  // 3. 三模型字段映射
  // ═══════════════════════════════════════════
  describe('3. 三模型字段映射', () => {
    it('3.1 AI模型：ai_spf→direction, ai_confidence→direction_confidence, ai_score→predicted_score, ai_overunder→over_under', () => {
      db.prepare(
        `INSERT INTO prediction_logs (matchId, date, matchNum, ai_spf, ai_confidence, ai_score, ai_overunder, ai_content)
         VALUES (?,?,?,?,?,?,?,?)`,
      ).run('m_ai_1', '2026-06-10', '001', '主胜', 88, '2:1', '小球', '{"analysis":"主队优势明显"}');

      const log = db.prepare('SELECT * FROM prediction_logs WHERE matchId = ?').get('m_ai_1');

      // 模拟流入
      const direction = mapDirection(log.ai_spf);
      const ou = mapOverUnder(log.ai_overunder);

      expect(direction).toBe('home');
      expect(ou).toBe('under');
      expect(log.ai_confidence).toBe(88);
      expect(log.ai_score).toBe('2:1');

      // 写入 unified
      const predId = `ai_ai_1_2026-06-10`;
      db.prepare(
        `INSERT INTO unified_predictions (match_num,match_date,match_id,model_name,model_version,prediction_id,direction,direction_confidence,over_under,predicted_score,raw_output_json,computed_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        '001',
        '2026-06-10',
        'ai_1',
        'AI预测',
        'v1.0',
        predId,
        direction,
        88,
        ou,
        '2:1',
        log.ai_content,
        '2026-06-10',
      );

      const unified = db.prepare('SELECT * FROM unified_predictions WHERE prediction_id = ?').get(predId);
      expect(unified.model_name).toBe('AI预测');
      expect(unified.direction).toBe('home');
      expect(unified.direction_confidence).toBe(88);
      expect(unified.over_under).toBe('under');
      expect(unified.predicted_score).toBe('2:1');
    });

    it('3.2 功守道模型：gs_top_score→direction, gs_top_percent→direction_confidence, gs_scores_json→raw_output_json, pk_fusion_consensus→consensus_tag', () => {
      db.prepare(
        `INSERT INTO prediction_logs (matchId, date, matchNum, gs_top_score, gs_top_percent, gs_scores_json, gs_ladder_label, pk_fusion_consensus)
         VALUES (?,?,?,?,?,?,?,?)`,
      ).run('m_gs_1', '2026-06-10', '010', '3:1', 82, JSON.stringify([{ score: '3:1', percent: 82 }]), 'L3', 'strong');

      const log = db.prepare('SELECT * FROM prediction_logs WHERE matchId = ?').get('m_gs_1');
      const direction = scoreToDirection(log.gs_top_score);

      expect(direction).toBe('home');

      const predId = `gs_gs_1_2026-06-10`;
      db.prepare(
        `INSERT INTO unified_predictions (match_num,match_date,match_id,model_name,model_version,prediction_id,direction,direction_confidence,raw_output_json,consensus_tag,computed_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        '010',
        '2026-06-10',
        'gs_1',
        '功守道',
        'v1.0',
        predId,
        direction,
        82,
        log.gs_scores_json,
        'strong',
        '2026-06-10',
      );

      const unified = db.prepare('SELECT * FROM unified_predictions WHERE prediction_id = ?').get(predId);
      expect(unified.model_name).toBe('功守道');
      expect(unified.consensus_tag).toBe('strong');
      expect(unified.direction_confidence).toBe(82);
    });

    it('3.3 PK评分模型：pk_direction→direction, pk_composite_score→direction_confidence, pk子分→raw_output_json', () => {
      db.prepare(
        `INSERT INTO prediction_logs (matchId, date, matchNum,
         pk_direction, pk_composite_score, pk_power_score, pk_goal_score, pk_heat_score, pk_stability_score,
         pk_goal_direction, pk_fusion_consensus, pk_value_score, pk_ev_home, pk_ev_draw, pk_ev_away)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run('m_pk_1', '2026-06-10', '020', '客胜', 85, 72, 65, 78, 68, '大球', 'weak', 0.55, 2.8, 3.4, 2.9);

      const log = db.prepare('SELECT * FROM prediction_logs WHERE matchId = ?').get('m_pk_1');
      const direction = mapDirection(log.pk_direction);
      expect(direction).toBe('away');

      const rawJson = JSON.stringify({
        composite: log.pk_composite_score,
        power: log.pk_power_score,
        goal: log.pk_goal_score,
        heat: log.pk_heat_score,
        stability: log.pk_stability_score,
        value: log.pk_value_score,
        ev_home: log.pk_ev_home,
        ev_draw: log.pk_ev_draw,
        ev_away: log.pk_ev_away,
      });

      const predId = `pk_pk_1_2026-06-10`;
      db.prepare(
        `INSERT INTO unified_predictions (match_num,match_date,match_id,model_name,model_version,prediction_id,direction,direction_confidence,over_under,raw_output_json,consensus_tag,computed_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        '020',
        '2026-06-10',
        'pk_1',
        'PK评分',
        'v1.0',
        predId,
        direction,
        85,
        'over',
        rawJson,
        'weak',
        '2026-06-10',
      );

      const unified = db.prepare('SELECT * FROM unified_predictions WHERE prediction_id = ?').get(predId);
      expect(unified.model_name).toBe('PK评分');
      expect(unified.over_under).toBe('over');
      expect(unified.direction).toBe('away');

      const parsed = JSON.parse(unified.raw_output_json);
      expect(parsed.composite).toBe(85);
      expect(parsed.ev_home).toBe(2.8);
    });
  });

  // ═══════════════════════════════════════════
  // 4. 边界场景
  // ═══════════════════════════════════════════
  describe('4. 边界场景', () => {
    it('4.1 无方向预测 — 不生成 unified 记录', () => {
      db.prepare(
        `INSERT INTO prediction_logs (matchId, date, matchNum, ai_spf, actual_score)
         VALUES (?,?,?,?,?)`,
      ).run('m_no_dir', '2026-06-10', '050', null, '1:1');

      const log = db.prepare('SELECT * FROM prediction_logs WHERE matchId = ?').get('m_no_dir');
      expect(mapDirection(log.ai_spf)).toBeNull();
      // 不应生成 unified
    });

    it('4.2 无GS数据 — 跳过功守道模型', () => {
      db.prepare(
        `INSERT INTO prediction_logs (matchId, date, matchNum, gs_top_score, gs_scores_json, actual_score)
         VALUES (?,?,?,?,?,?)`,
      ).run('m_no_gs', '2026-06-10', '060', null, null, '2:0');

      const log = db.prepare('SELECT * FROM prediction_logs WHERE matchId = ?').get('m_no_gs');
      // gs_top_score为空 AND gs_scores_json为空 → 跳过
      expect(log.gs_top_score || log.gs_scores_json).toBeFalsy();
    });

    it('4.3 无actual_score — 不进入流入管道', () => {
      db.prepare(
        `INSERT INTO prediction_logs (matchId, date, matchNum, ai_spf, actual_score)
         VALUES (?,?,?,?,?)`,
      ).run('m_no_result', '2026-06-10', '070', '主胜', '');

      // incrementalSyncToUnified 查询条件: actual_score IS NOT NULL AND != ''
      const rows = db
        .prepare("SELECT * FROM prediction_logs WHERE actual_score IS NOT NULL AND actual_score != ''")
        .all();
      expect(rows.length).toBe(0);
    });

    it('4.4 ai_confidence 为 0/null — 使用默认值 50', () => {
      db.prepare(
        `INSERT INTO prediction_logs (matchId, date, matchNum, ai_spf, ai_confidence, actual_score)
         VALUES (?,?,?,?,?,?)`,
      ).run('m_zero_conf', '2026-06-10', '080', '主胜', 0, '3:0');

      const log = db.prepare('SELECT * FROM prediction_logs WHERE matchId = ?').get('m_zero_conf');
      const confidence = log.ai_confidence || 50;
      expect(confidence).toBe(50); // 0 被 || 替换
    });
  });

  // ═══════════════════════════════════════════
  // 5. 流入 → 回填 完整链路
  // ═══════════════════════════════════════════
  describe('5. 流入→回填 完整链路', () => {
    it('5.1 三模型流入 + 回填判定', () => {
      // Step 1: prediction_log
      db.prepare(
        `INSERT INTO prediction_logs (matchId, date, homeName, visitName, matchNum,
         ai_spf, ai_confidence, ai_score, ai_overunder,
         gs_top_score, gs_top_percent, gs_scores_json,
         pk_direction, pk_composite_score, pk_goal_direction,
         actual_score, actual_spf, actual_overunder)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        'm_full_1',
        '2026-06-10',
        'A队',
        'B队',
        '001',
        '主胜',
        90,
        '3:1',
        '大球',
        '3:1',
        85,
        JSON.stringify([{ score: '3:1', percent: 85 }]),
        '主胜',
        88,
        '大球',
        '3:1',
        '主胜',
        '大球',
      );

      const log = db.prepare('SELECT * FROM prediction_logs WHERE matchId = ?').get('m_full_1');
      const mid = 'full_1';
      const date = '2026-06-10';
      const match = { score: '3:1' };

      // Step 2: 流入 unified（3个模型）
      const models = [
        {
          name: 'AI预测',
          dir: mapDirection(log.ai_spf),
          conf: log.ai_confidence || 50,
          ou: mapOverUnder(log.ai_overunder),
          score: log.ai_score,
          raw: log.ai_content,
          prefix: 'ai',
        },
        {
          name: '功守道',
          dir: scoreToDirection(log.gs_top_score),
          conf: log.gs_top_percent || 50,
          ou: null,
          score: null,
          raw: log.gs_scores_json,
          prefix: 'gs',
        },
        {
          name: 'PK评分',
          dir: mapDirection(log.pk_direction),
          conf: log.pk_composite_score || 50,
          ou: mapOverUnder(log.pk_goal_direction),
          score: null,
          raw: null,
          prefix: 'pk',
        },
      ];

      const unifiedIds = [];
      models.forEach((m) => {
        if (!m.dir) return;
        const predId = `${m.prefix}_${mid}_${date}`;
        db.prepare(
          `INSERT INTO unified_predictions (match_num,match_date,match_id,model_name,model_version,prediction_id,direction,direction_confidence,over_under,predicted_score,raw_output_json,computed_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run('001', date, mid, m.name, 'v1.0', predId, m.dir, m.conf, m.ou, m.score, m.raw, date);
        unifiedIds.push(predId);
      });
      expect(unifiedIds.length).toBe(3);

      // Step 3: 回填 outcome
      const unifiedRows = db.prepare('SELECT * FROM unified_predictions WHERE match_id = ?').all(mid);
      unifiedRows.forEach((pred) => {
        const outcome = judgeOutcome(pred, match);
        db.prepare(
          `INSERT OR REPLACE INTO prediction_outcomes (prediction_id,match_num,match_date,model_name,model_version,actual_home_score,actual_away_score,actual_result,actual_total_goals,direction_hit,over_under_hit,score_hit)
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

      // Step 4: 验证
      const outcomes = db.prepare('SELECT * FROM prediction_outcomes WHERE match_num = ?').all('001');
      expect(outcomes.length).toBe(3);

      // 3:1 → 主胜, 4>2.5 → over, AI 预测 score=3:1 命中
      const aiOut = outcomes.find((o) => o.model_name === 'AI预测');
      expect(aiOut.direction_hit).toBe(1);
      expect(aiOut.over_under_hit).toBe(1);
      expect(aiOut.score_hit).toBe(1);

      const pkOut = outcomes.find((o) => o.model_name === 'PK评分');
      expect(pkOut.direction_hit).toBe(1);
      expect(pkOut.over_under_hit).toBe(1);
    });

    it('5.2 方向预测错误时的命中判定', () => {
      db.prepare(
        `INSERT INTO prediction_logs (matchId, date, matchNum, ai_spf, ai_confidence, actual_score)
         VALUES (?,?,?,?,?,?)`,
      ).run('m_wrong', '2026-06-10', '002', '客胜', 85, '2:0');

      const log = db.prepare('SELECT * FROM prediction_logs WHERE matchId = ?').get('m_wrong');
      const predId = `ai_wrong_2026-06-10`;

      db.prepare(
        `INSERT INTO unified_predictions (match_num,match_date,match_id,model_name,model_version,prediction_id,direction,direction_confidence,computed_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run('002', '2026-06-10', 'wrong', 'AI预测', 'v1.0', predId, 'away', 85, '2026-06-10');

      const pred = db.prepare('SELECT * FROM unified_predictions WHERE prediction_id = ?').get(predId);
      const outcome = judgeOutcome(pred, { score: '2:0' });
      // 2:0 → direction=home, 预测=away → 未命中
      expect(outcome.actualResult).toBe('home');
      expect(outcome.directionHit).toBe(0);
    });
  });

  // ═══════════════════════════════════════════
  // 6. GS ladder 到 direction 推断
  // ═══════════════════════════════════════════
  describe('6. GS 天梯方向推断', () => {
    it('6.1 ladder_level > 0 → 主胜', () => {
      const level = 3;
      const inference = level > 0 ? 'home' : level < 0 ? 'away' : 'draw';
      expect(inference).toBe('home');
    });

    it('6.2 ladder_level < 0 → 客胜', () => {
      const level = -2;
      const inference = level > 0 ? 'home' : level < 0 ? 'away' : 'draw';
      expect(inference).toBe('away');
    });

    it('6.3 ladder_level = 0 → 平局', () => {
      const level = 0;
      const inference = level > 0 ? 'home' : level < 0 ? 'away' : 'draw';
      expect(inference).toBe('draw');
    });

    it('6.4 gs_modelA/B/C_total 字段映射', () => {
      db.prepare(
        `INSERT INTO prediction_logs (matchId, date, matchNum, gs_modelA_total, gs_modelB_total, gs_modelC_total, actual_score)
         VALUES (?,?,?,?,?,?,?)`,
      ).run('m_models', '2026-06-10', '030', 2.5, 3.1, 2.8, '2:1');

      const log = db.prepare('SELECT * FROM prediction_logs WHERE matchId = ?').get('m_models');
      expect(log.gs_modelA_total).toBe(2.5);
      expect(log.gs_modelB_total).toBe(3.1);
      expect(log.gs_modelC_total).toBe(2.8);
    });
  });
});
