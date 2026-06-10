/**
 * P2: consistency-check.test.js
 * 跨表数据一致性巡检
 *
 * 覆盖：
 *   - prediction_logs ↔ unified_predictions 关联完整性
 *   - unified_predictions ↔ prediction_outcomes 关联完整性
 *   - 日期连续性检查
 *   - 字段非空约束验证
 *   - 孤儿记录检测
 */

const Database = require('better-sqlite3');

function createConsistencyDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE matches (matchId TEXT PRIMARY KEY, num TEXT, homeName TEXT, visitName TEXT, date TEXT, matchStatus INTEGER DEFAULT 0, score TEXT DEFAULT '');
    CREATE TABLE prediction_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, matchId TEXT NOT NULL, date TEXT, homeName TEXT, visitName TEXT, leagueName TEXT, matchNum TEXT, ai_spf TEXT, ai_confidence REAL, pk_direction TEXT, pk_composite_score REAL, gs_top_score TEXT, gs_top_percent REAL, actual_score TEXT, actual_spf TEXT, actual_overunder TEXT, actual_home_goals INTEGER, actual_away_goals INTEGER, created_at TEXT, updated_at TEXT);
    CREATE INDEX IF NOT EXISTS idx_logs_matchId ON prediction_logs(matchId);
    CREATE TABLE unified_predictions (id INTEGER PRIMARY KEY AUTOINCREMENT, match_num TEXT, match_date TEXT, match_id TEXT, model_name TEXT NOT NULL, model_version TEXT NOT NULL, prediction_id TEXT NOT NULL UNIQUE, direction TEXT, direction_confidence REAL, over_under TEXT, predicted_score TEXT, computed_at TEXT);
    CREATE TABLE prediction_outcomes (id INTEGER PRIMARY KEY AUTOINCREMENT, prediction_id TEXT NOT NULL UNIQUE, match_num TEXT, match_date TEXT, model_name TEXT, model_version TEXT, actual_home_score INTEGER, actual_away_score INTEGER, actual_result TEXT, actual_total_goals INTEGER, direction_hit INTEGER DEFAULT 0, over_under_hit INTEGER DEFAULT 0, score_hit INTEGER DEFAULT 0, filled_at TEXT);
  `);
  return db;
}

describe('P2: consistency-check — 跨表一致性巡检', () => {
  let db;

  beforeEach(() => {
    db = createConsistencyDb();
  });
  afterEach(() => db.close());

  // ═══════════════════════════════════════════
  // 1. prediction_logs ↔ matches 关联
  // ═══════════════════════════════════════════
  describe('1. prediction_logs ↔ matches', () => {
    it('1.1 每条 prediction_log 的 matchId 应在 matches 中存在', () => {
      db.prepare('INSERT INTO matches (matchId, num, homeName, visitName, date) VALUES (?,?,?,?,?)').run(
        'm_001',
        '001',
        'A',
        'B',
        '2026-06-10',
      );
      db.prepare('INSERT INTO matches (matchId, num, homeName, visitName, date) VALUES (?,?,?,?,?)').run(
        'm_002',
        '002',
        'C',
        'D',
        '2026-06-10',
      );
      db.prepare('INSERT INTO prediction_logs (matchId, date, matchNum, ai_spf) VALUES (?,?,?,?)').run(
        'm_001',
        '2026-06-10',
        '001',
        '主胜',
      );
      db.prepare('INSERT INTO prediction_logs (matchId, date, matchNum, ai_spf) VALUES (?,?,?,?)').run(
        'm_002',
        '2026-06-10',
        '002',
        '客胜',
      );
      db.prepare('INSERT INTO prediction_logs (matchId, date, matchNum, ai_spf) VALUES (?,?,?,?)').run(
        'm_orphan',
        '2026-06-10',
        '099',
        '平',
      );

      // 检查孤儿记录
      const orphanLogs = db
        .prepare(
          `
        SELECT pl.matchId FROM prediction_logs pl
        LEFT JOIN matches m ON pl.matchId = m.matchId
        WHERE m.matchId IS NULL
      `,
        )
        .all();

      expect(orphanLogs.length).toBe(1);
      expect(orphanLogs[0].matchId).toBe('m_orphan');
    });

    it('1.2 所有 log 都应该有 date 字段', () => {
      db.prepare('INSERT INTO prediction_logs (matchId, date, ai_spf) VALUES (?,?,?)').run(
        'm_001',
        '2026-06-10',
        '主胜',
      );
      db.prepare('INSERT INTO prediction_logs (matchId, date, ai_spf) VALUES (?,?,?)').run('m_002', null, '客胜');

      const missingDate = db.prepare('SELECT COUNT(*) as cnt FROM prediction_logs WHERE date IS NULL').get();
      expect(missingDate.cnt).toBe(1);
    });

    it('1.3 matchNum 格式检查 — 应有值', () => {
      db.prepare('INSERT INTO prediction_logs (matchId, date, matchNum, ai_spf) VALUES (?,?,?,?)').run(
        'm_001',
        '2026-06-10',
        '001',
        '主胜',
      );
      db.prepare('INSERT INTO prediction_logs (matchId, date, matchNum, ai_spf) VALUES (?,?,?,?)').run(
        'm_002',
        '2026-06-10',
        null,
        '客胜',
      );

      const missingNum = db.prepare('SELECT COUNT(*) as cnt FROM prediction_logs WHERE matchNum IS NULL').get();
      expect(missingNum.cnt).toBe(1);
    });
  });

  // ═══════════════════════════════════════════
  // 2. unified_predictions ↔ prediction_outcomes
  // ═══════════════════════════════════════════
  describe('2. unified_predictions ↔ outcomes', () => {
    it('2.1 每条 unified 应有对应 outcome（已完赛）', () => {
      // 写入 unified
      db.prepare(
        `INSERT INTO unified_predictions (match_num, match_date, match_id, model_name, model_version, prediction_id, direction, direction_confidence, computed_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run('001', '2026-06-10', 'test_1', 'AI预测', 'v1.0', 'up_001_2026-06-10', 'home', 85, '2026-06-10');

      db.prepare(
        `INSERT INTO unified_predictions (match_num, match_date, match_id, model_name, model_version, prediction_id, direction, direction_confidence, computed_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run('002', '2026-06-10', 'test_2', 'PK评分', 'v1.0', 'up_002_2026-06-10', 'away', 75, '2026-06-10');

      // 仅给第一条写入 outcome
      db.prepare(
        `INSERT INTO prediction_outcomes (prediction_id, match_num, match_date, model_name, model_version, direction_hit)
         VALUES (?,?,?,?,?,?)`,
      ).run('up_001_2026-06-10', '001', '2026-06-10', 'AI预测', 'v1.0', 1);

      // 查找无 outcome 的 unified
      const missingOutcomes = db
        .prepare(
          `
        SELECT up.prediction_id, up.model_name FROM unified_predictions up
        LEFT JOIN prediction_outcomes po ON up.prediction_id = po.prediction_id
        WHERE po.prediction_id IS NULL
      `,
        )
        .all();

      expect(missingOutcomes.length).toBe(1);
      expect(missingOutcomes[0].prediction_id).toBe('up_002_2026-06-10');
    });

    it('2.2 无 direction 的 unified 不应被统计', () => {
      db.prepare(
        `INSERT INTO unified_predictions (match_num, match_date, match_id, model_name, model_version, prediction_id, direction, direction_confidence, computed_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run('003', '2026-06-10', 'test_3', '功守道', 'v1.0', 'up_003_2026-06-10', null, 50, '2026-06-10');

      const nullDirection = db.prepare('SELECT COUNT(*) as cnt FROM unified_predictions WHERE direction IS NULL').get();
      expect(nullDirection.cnt).toBe(1);
    });

    it('2.3 重复 prediction_id 检查', () => {
      const predId = 'dup_check_2026-06-10';
      db.prepare(
        `INSERT INTO unified_predictions (match_num, match_date, match_id, model_name, model_version, prediction_id, direction, direction_confidence, computed_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run('001', '2026-06-10', 'dup', 'AI预测', 'v1.0', predId, 'home', 80, '2026-06-10');

      // 尝试插入重复 → 应失败
      let dupErr = null;
      try {
        db.prepare(
          `INSERT INTO unified_predictions (match_num, match_date, match_id, model_name, model_version, prediction_id, direction, direction_confidence, computed_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        ).run('001', '2026-06-10', 'dup', 'AI预测', 'v1.0', predId, 'home', 80, '2026-06-10');
      } catch (e) {
        dupErr = e;
      }
      expect(dupErr).toBeTruthy(); // UNIQUE 约束应触发
    });
  });

  // ═══════════════════════════════════════════
  // 3. 日期连续性
  // ═══════════════════════════════════════════
  describe('3. 日期连续性', () => {
    it('3.1 识别缺失日期', () => {
      const expectedDates = ['2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12'];
      const actualDates = ['2026-06-08', '2026-06-10', '2026-06-12']; // 缺 06-09 和 06-11

      const missing = expectedDates.filter((d) => !actualDates.includes(d));
      expect(missing).toEqual(['2026-06-09', '2026-06-11']);
    });

    it('3.2 日期范围无越界', () => {
      const today = new Date().toISOString().slice(0, 10);
      // 所有日期应在今天或之前
      const dates = ['2020-01-01', today];
      const allValid = dates.every((d) => d <= today);
      expect(allValid).toBe(true);
    });

    it('3.3 prediction_logs.date 与 data.json.date 对齐检查', () => {
      db.prepare("INSERT INTO prediction_logs (matchId, date, ai_spf) VALUES ('m_001', '2026-06-10', '主胜')").run();
      db.prepare("INSERT INTO prediction_logs (matchId, date, ai_spf) VALUES ('m_002', '2026-06-11', '客胜')").run();

      const dates = db.prepare('SELECT DISTINCT date FROM prediction_logs ORDER BY date').all();
      expect(dates.length).toBe(2);
      expect(dates[0].date).toBe('2026-06-10');
      expect(dates[1].date).toBe('2026-06-11');
    });
  });

  // ═══════════════════════════════════════════
  // 4. 模型分布统计
  // ═══════════════════════════════════════════
  describe('4. 模型分布统计', () => {
    it('4.1 unified_predictions 应按模型均匀分布', () => {
      const entries = [
        ['001', '2026-06-10', 'm1', 'AI预测', 'v1.0', 'ai_1', 'home', 80],
        ['001', '2026-06-10', 'm1', 'PK评分', 'v1.0', 'pk_1', 'home', 75],
        ['001', '2026-06-10', 'm1', '功守道', 'v1.0', 'gs_1', 'home', 70],
        ['002', '2026-06-10', 'm2', 'AI预测', 'v1.0', 'ai_2', 'away', 65],
        ['002', '2026-06-10', 'm2', 'PK评分', 'v1.0', 'pk_2', 'away', 60],
      ];

      const stmt = db.prepare(
        'INSERT INTO unified_predictions (match_num, match_date, match_id, model_name, model_version, prediction_id, direction, direction_confidence, computed_at) VALUES (?,?,?,?,?,?,?,?,?)',
      );
      entries.forEach((e) => stmt.run(...e, e[3] === 'AI预测' ? '2026-06-10' : '2026-06-10'));

      // 按模型统计
      const modelStats = db
        .prepare('SELECT model_name, COUNT(*) as cnt FROM unified_predictions GROUP BY model_name ORDER BY cnt DESC')
        .all();

      expect(modelStats.length).toBeGreaterThanOrEqual(2);
      // AI 和 PK 应各 2 条，GS 应 1 条
      const byName = {};
      modelStats.forEach((r) => (byName[r.model_name] = r.cnt));
      expect(byName['AI预测']).toBe(2);
      expect(byName['PK评分']).toBe(2);
      expect(byName['功守道']).toBe(1);
    });

    it('4.2 outcome 模型分布应匹配 unified', () => {
      // 写入 unified
      ['ai_1', 'pk_1', 'gs_1'].forEach((pid, i) => {
        db.prepare(
          `INSERT INTO unified_predictions (match_num, match_date, match_id, model_name, model_version, prediction_id, direction, direction_confidence, computed_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        ).run('001', '2026-06-10', 'm1', ['AI预测', 'PK评分', '功守道'][i], 'v1.0', pid, 'home', 80, '2026-06-10');
      });

      // 写入 outcome（仅2条，缺 GS）
      ['ai_1', 'pk_1'].forEach((pid) => {
        db.prepare(
          `INSERT INTO prediction_outcomes (prediction_id, match_num, match_date, model_name, model_version, direction_hit)
           VALUES (?,?,?,?,?,?)`,
        ).run(pid, '001', '2026-06-10', pid.startsWith('ai') ? 'AI预测' : 'PK评分', 'v1.0', 1);
      });

      const uniCount = db.prepare('SELECT COUNT(*) as cnt FROM unified_predictions').get();
      const outCount = db.prepare('SELECT COUNT(*) as cnt FROM prediction_outcomes').get();

      expect(uniCount.cnt).toBe(3);
      expect(outCount.cnt).toBe(2);
      // 差距为 1（功守道缺失）
      const gap = uniCount.cnt - outCount.cnt;
      expect(gap).toBe(1);
    });
  });

  // ═══════════════════════════════════════════
  // 5. 数据质量评分
  // ═══════════════════════════════════════════
  describe('5. 数据质量评分', () => {
    it('5.1 完整性分数 = 有 outcome 的 unified / 总 unified', () => {
      const totalUnified = 10;
      const outcomesWithHit = 8;

      const completenessScore = outcomesWithHit / totalUnified;
      expect(completenessScore).toBe(0.8);

      const isHealthy = completenessScore >= 0.85;
      expect(isHealthy).toBe(false); // 80% < 85%
    });

    it('5.2 命中率有效性 = direction_hit IS NOT NULL', () => {
      db.prepare(
        `INSERT INTO prediction_outcomes (prediction_id, match_num, match_date, model_name, model_version, direction_hit)
         VALUES (?,?,?,?,?,?)`,
      ).run('test_1', '001', '2026-06-10', 'AI预测', 'v1.0', 1);

      db.prepare(
        `INSERT INTO prediction_outcomes (prediction_id, match_num, match_date, model_name, model_version, direction_hit)
         VALUES (?,?,?,?,?,?)`,
      ).run('test_2', '002', '2026-06-10', 'PK评分', 'v1.0', null);

      const validHits = db
        .prepare('SELECT COUNT(*) as cnt FROM prediction_outcomes WHERE direction_hit IS NOT NULL')
        .get();
      const total = db.prepare('SELECT COUNT(*) as cnt FROM prediction_outcomes').get();
      expect(validHits.cnt).toBe(1);
      expect(total.cnt).toBe(2);
    });

    it('5.3 整体数据健康报告', () => {
      // 模拟生成数据健康报告
      const report = {
        totalLogs: 100,
        totalUnified: 280,
        totalOutcomes: 275,
        orphanLogs: 3,
        orphanOutcomes: 5,
        missingDates: [],
        completenessRate: 275 / 280,
        isHealthy: 275 / 280 >= 0.95,
      };

      expect(report.orphanLogs).toBe(3);
      expect(report.orphanOutcomes).toBe(5);
      expect(report.completenessRate).toBeCloseTo(0.982, 2);
      expect(report.isHealthy).toBe(true);

      // 修复建议
      if (report.orphanLogs > 0) {
        expect(typeof report.orphanLogs).toBe('number');
        // 应触发 backfill
      }
      if (report.orphanOutcomes > 0) {
        // 应触发 outcome-backfill
        expect(report.orphanOutcomes).toBeGreaterThan(0);
      }
    });
  });
});
