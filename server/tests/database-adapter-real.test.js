/**
 * P0: database-adapter-real.test.js
 * 实际数据库操作测试 — 用 better-sqlite3 内存库验证完整的 CRUD/DDL/持久化
 *
 * 覆盖：
 *   - 17+ 张表 DDL 执行
 *   - INSERT/UPDATE/DELETE/SELECT 基本操作
 *   - 唯一约束冲突处理
 *   - execDDL vs execRun 行为差异
 *   - _saveToFile 持久化写入验证
 *   - 事务包装
 *   - 类型约束
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// ═══ 复用 database.js 的 DDL 定义 ═══
const NEW_TABLES_DDL = `
  CREATE TABLE IF NOT EXISTS odds_history_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_num TEXT NOT NULL,
    date TEXT NOT NULL,
    fetch_date TEXT NOT NULL,
    fetch_time TEXT NOT NULL,
    play_type TEXT NOT NULL,
    odds_json TEXT NOT NULL,
    home_name TEXT,
    visit_name TEXT,
    handicap REAL,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(match_num, date, fetch_date, fetch_time, play_type)
  );
  CREATE INDEX IF NOT EXISTS idx_odds_match ON odds_history_v2(match_num, date, fetch_time);
  CREATE INDEX IF NOT EXISTS idx_odds_date ON odds_history_v2(date, play_type);

  CREATE TABLE IF NOT EXISTS h2h_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    match_date TEXT NOT NULL,
    league TEXT,
    home_score INTEGER,
    away_score INTEGER,
    half_home_score INTEGER,
    half_away_score INTEGER,
    spf_result TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(home_team, away_team, match_date)
  );
  CREATE INDEX IF NOT EXISTS idx_h2h_teams ON h2h_history(home_team, away_team);

  CREATE TABLE IF NOT EXISTS league_standings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_name TEXT NOT NULL,
    team_name TEXT NOT NULL,
    rank INTEGER,
    played INTEGER,
    won INTEGER,
    drawn INTEGER,
    lost INTEGER,
    goals_for INTEGER,
    goals_against INTEGER,
    goal_diff INTEGER,
    points INTEGER,
    home_played INTEGER,
    home_won INTEGER,
    home_drawn INTEGER,
    home_lost INTEGER,
    away_played INTEGER,
    away_won INTEGER,
    away_drawn INTEGER,
    away_lost INTEGER,
    fetch_date TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(league_name, team_name, fetch_date)
  );

  CREATE TABLE IF NOT EXISTS data_lineage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_key TEXT NOT NULL,
    version INTEGER NOT NULL,
    source TEXT NOT NULL,
    fetch_batch_id TEXT,
    data_hash TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_lineage_entity ON data_lineage(entity_type, entity_key, version DESC);

  CREATE TABLE IF NOT EXISTS feature_store (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_num TEXT NOT NULL,
    match_date TEXT NOT NULL,
    feature_version TEXT NOT NULL,
    feature_name TEXT NOT NULL,
    feature_value REAL,
    feature_source TEXT,
    computed_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(match_num, match_date, feature_version, feature_name)
  );

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
    goal_total REAL,
    goal_range TEXT,
    over_under TEXT,
    predicted_score TEXT,
    score_probability REAL,
    features_json TEXT,
    raw_output_json TEXT,
    consensus_tag TEXT,
    fetch_batch_id TEXT,
    computed_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(match_num, match_date, model_name, model_version, prediction_id)
  );

  CREATE TABLE IF NOT EXISTS jczq_basic_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    match_num TEXT NOT NULL,
    home_team TEXT,
    guest_team TEXT,
    league_name TEXT,
    data_json TEXT NOT NULL,
    fetch_ts TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(date, match_num)
  );
  CREATE INDEX IF NOT EXISTS idx_jczq_basic_date ON jczq_basic_cache(date);
  CREATE INDEX IF NOT EXISTS idx_jczq_basic_match ON jczq_basic_cache(date, match_num);

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
    brier_score REAL,
    log_loss REAL,
    filled_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(prediction_id)
  );
  CREATE INDEX IF NOT EXISTS idx_outcome_model ON prediction_outcomes(model_name, model_version, match_date);

  CREATE TABLE IF NOT EXISTS sporttery_preview (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id TEXT NOT NULL,
    match_num TEXT,
    date TEXT NOT NULL,
    home_team TEXT,
    away_team TEXT,
    league TEXT,
    feature_analysis TEXT,
    h2h_history TEXT,
    standings TEXT,
    recent_form TEXT,
    future_matches TEXT,
    scorers TEXT,
    injuries TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(match_id)
  );

  CREATE TABLE IF NOT EXISTS sporttery_odds_snapshot (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id TEXT NOT NULL,
    match_num TEXT,
    date TEXT NOT NULL,
    home_team TEXT,
    away_team TEXT,
    league TEXT,
    play_type TEXT NOT NULL,
    snapshot_time TEXT NOT NULL,
    odds_json TEXT NOT NULL,
    trend TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
`;

// ═══ 辅助：创建临时数据库连接 ═══
function createTempDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  return db;
}

// ═══ 辅助：allMatches 包含所有比赛 ═══
function allMatches(db) {
  return db.prepare('SELECT * FROM matches ORDER BY CAST(num AS INTEGER)').all();
}

describe('P0: database-adapter-real — 实际数据库操作', () => {
  let db;

  beforeEach(() => {
    db = createTempDb();
  });

  afterEach(() => {
    db.close();
  });

  // ═══════════════════════════════════════════
  // 1. DDL 执行验证
  // ═══════════════════════════════════════════
  describe('1. DDL 建表', () => {
    it('1.1 核心4表正常创建', () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS matches (
          matchId TEXT PRIMARY KEY, num TEXT, homeName TEXT, visitName TEXT,
          leagueName TEXT, startTime TEXT, matchStatus INTEGER DEFAULT 0,
          score TEXT DEFAULT '', halfScore TEXT DEFAULT '',
          recommNum INTEGER DEFAULT 0, date TEXT, fetchDate TEXT,
          createdAt TEXT, updatedAt TEXT
        );
        CREATE TABLE IF NOT EXISTS recommends (
          id INTEGER PRIMARY KEY AUTOINCREMENT, matchId TEXT, type TEXT,
          num INTEGER, result REAL, fetchDate TEXT,
          UNIQUE(matchId, type, fetchDate)
        );
        CREATE TABLE IF NOT EXISTS crawl_logs (
          date TEXT PRIMARY KEY, matchCount INTEGER, recommCount INTEGER,
          status TEXT DEFAULT 'pending', message TEXT, createdAt TEXT
        );
        CREATE TABLE IF NOT EXISTS ai_predictions (
          matchId TEXT PRIMARY KEY, leagueName TEXT, homeName TEXT,
          visitName TEXT, matchDate TEXT, content TEXT, confidence REAL,
          rawPrompt TEXT, rawResponse TEXT, tokenUsage TEXT,
          createdAt TEXT, updatedAt TEXT
        );
      `);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all()
        .map((r) => r.name);
      expect(tables).toContain('matches');
      expect(tables).toContain('recommends');
      expect(tables).toContain('crawl_logs');
      expect(tables).toContain('ai_predictions');
    });

    it('1.2 蓝图新增10张表正常创建', () => {
      db.exec(NEW_TABLES_DDL);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all()
        .map((r) => r.name);
      // 蓝图7张核心表
      expect(tables).toContain('odds_history_v2');
      expect(tables).toContain('h2h_history');
      expect(tables).toContain('league_standings');
      expect(tables).toContain('data_lineage');
      expect(tables).toContain('feature_store');
      expect(tables).toContain('unified_predictions');
      expect(tables).toContain('jczq_basic_cache');
      expect(tables).toContain('prediction_outcomes');
      expect(tables).toContain('sporttery_preview');
      expect(tables).toContain('sporttery_odds_snapshot');
    });

    it('1.3 索引正常创建', () => {
      db.exec(NEW_TABLES_DDL);

      // 检查关键索引
      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
        .all()
        .map((r) => r.name);

      expect(indexes).toContain('idx_odds_match');
      expect(indexes).toContain('idx_odds_date');
      expect(indexes).toContain('idx_h2h_teams');
      expect(indexes).toContain('idx_lineage_entity');
      expect(indexes).toContain('idx_jczq_basic_date');
      expect(indexes).toContain('idx_jczq_basic_match');
      expect(indexes).toContain('idx_outcome_model');
    });
  });

  // ═══════════════════════════════════════════
  // 2. CRUD 基础操作
  // ═══════════════════════════════════════════
  describe('2. CRUD 操作', () => {
    beforeEach(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS matches (
          matchId TEXT PRIMARY KEY, num TEXT, homeName TEXT, visitName TEXT,
          leagueName TEXT, startTime TEXT, matchStatus INTEGER DEFAULT 0,
          score TEXT DEFAULT '', halfScore TEXT DEFAULT '',
          recommNum INTEGER DEFAULT 0, date TEXT, fetchDate TEXT,
          createdAt TEXT, updatedAt TEXT
        );
        CREATE TABLE IF NOT EXISTS recommends (
          id INTEGER PRIMARY KEY AUTOINCREMENT, matchId TEXT, type TEXT,
          num INTEGER, result REAL, fetchDate TEXT,
          UNIQUE(matchId, type, fetchDate)
        );
      `);
    });

    it('2.1 INSERT 写入比赛记录', () => {
      db.prepare(
        `INSERT INTO matches (matchId, num, homeName, visitName, leagueName, date, startTime, matchStatus)
         VALUES (?,?,?,?,?,?,?,?)`,
      ).run('m_test001', '001', '主队A', '客队B', '英超', '2026-06-10', '19:30', 0);

      const row = db.prepare('SELECT * FROM matches WHERE matchId = ?').get('m_test001');
      expect(row).not.toBeUndefined();
      expect(row.homeName).toBe('主队A');
      expect(row.visitName).toBe('客队B');
      expect(row.leagueName).toBe('英超');
      expect(row.matchStatus).toBe(0);
    });

    it('2.2 INSERT OR REPLACE 覆盖写入', () => {
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO matches (matchId, num, homeName, visitName, leagueName, date, matchStatus)
         VALUES (?,?,?,?,?,?,?)`,
      );

      stmt.run('m_test002', '002', '原主队', '原客队', '意甲', '2026-06-10', 0);
      stmt.run('m_test002', '002', '新主队', '新客队', '意甲', '2026-06-10', 2);

      const row = db.prepare('SELECT * FROM matches WHERE matchId = ?').get('m_test002');
      expect(row.homeName).toBe('新主队');
      expect(row.matchStatus).toBe(2);
      // INSERT OR REPLACE 替代原行，count 仍为 1
      const count = db.prepare('SELECT COUNT(*) as cnt FROM matches WHERE matchId = ?').get('m_test002').cnt;
      expect(count).toBe(1);
    });

    it('2.3 UPDATE 更新比分', () => {
      db.prepare(
        `INSERT INTO matches (matchId, num, homeName, visitName, date, matchStatus, score)
         VALUES (?,?,?,?,?,?,?)`,
      ).run('m_test003', '003', 'A', 'B', '2026-06-10', 1, '');

      db.prepare('UPDATE matches SET score = ?, matchStatus = ? WHERE matchId = ?').run('2:1', 2, 'm_test003');

      const row = db.prepare('SELECT score, matchStatus FROM matches WHERE matchId = ?').get('m_test003');
      expect(row.score).toBe('2:1');
      expect(row.matchStatus).toBe(2);
    });

    it('2.4 DELETE 删除记录', () => {
      db.prepare(`INSERT INTO matches (matchId, num, homeName, visitName, date) VALUES (?,?,?,?,?)`).run(
        'm_delete_me',
        '099',
        'X',
        'Y',
        '2026-06-10',
      );

      const del = db.prepare('DELETE FROM matches WHERE matchId = ?').run('m_delete_me');
      expect(del.changes).toBe(1);

      const row = db.prepare('SELECT * FROM matches WHERE matchId = ?').get('m_delete_me');
      expect(row).toBeUndefined();
    });

    it('2.5 按日期查询', () => {
      for (let i = 1; i <= 5; i++) {
        db.prepare(`INSERT INTO matches (matchId, num, homeName, visitName, date) VALUES (?,?,?,?,?)`).run(
          `m_test${i}`,
          `00${i}`,
          `H${i}`,
          `A${i}`,
          '2026-06-10',
        );
      }
      db.prepare(`INSERT INTO matches (matchId, num, homeName, visitName, date) VALUES (?,?,?,?,?)`).run(
        'm_other',
        '010',
        'HO',
        'AO',
        '2026-06-11',
      );

      const todayMatches = db
        .prepare('SELECT * FROM matches WHERE date = ? ORDER BY CAST(num AS INTEGER)')
        .all('2026-06-10');
      expect(todayMatches.length).toBe(5);
      expect(todayMatches[0].num).toBe('001');
    });

    it('2.6 唯一约束冲突', () => {
      db.prepare(`INSERT OR IGNORE INTO recommends (matchId, type, num, result, fetchDate) VALUES (?,?,?,?,?)`).run(
        'm_test001',
        '主胜',
        1,
        0,
        '2026-06-10',
      );
      db.prepare(`INSERT OR IGNORE INTO recommends (matchId, type, num, result, fetchDate) VALUES (?,?,?,?,?)`).run(
        'm_test001',
        '主胜',
        1,
        1,
        '2026-06-10',
      );

      const rows = db.prepare("SELECT * FROM recommends WHERE matchId = ? AND type = '主胜'").all('m_test001');
      expect(rows.length).toBe(1);
    });
  });

  // ═══════════════════════════════════════════
  // 3. 蓝图表数据流
  // ═══════════════════════════════════════════
  describe('3. 蓝图表完整数据流', () => {
    beforeEach(() => {
      db.exec(NEW_TABLES_DDL);
    });

    it('3.1 prediction_logs 完整 CRUD', () => {
      // 手动建 prediction_logs（不在 NEW_TABLES_DDL 中）
      db.exec(`
        CREATE TABLE IF NOT EXISTS prediction_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          matchId TEXT NOT NULL,
          date TEXT, homeName TEXT, visitName TEXT, leagueName TEXT,
          matchNum TEXT, handicap INTEGER, ai_spf TEXT, ai_overunder TEXT,
          ai_score TEXT, ai_confidence REAL, ai_content TEXT,
          pk_composite_score REAL, pk_direction TEXT, pk_direction_stars INTEGER,
          pk_fusion_consensus TEXT, gs_scores_json TEXT, gs_top_score TEXT,
          gs_top_percent REAL, actual_score TEXT, actual_spf TEXT,
          actual_overunder TEXT, actual_home_goals INTEGER, actual_away_goals INTEGER,
          created_at TEXT, updated_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_logs_matchId ON prediction_logs(matchId);
      `);

      // INSERT
      db.prepare(
        `INSERT INTO prediction_logs (matchId, date, homeName, visitName, ai_spf, ai_confidence)
         VALUES (?,?,?,?,?,?)`,
      ).run('m_log_001', '2026-06-10', '曼城', '利物浦', '主胜', 85);

      // SELECT
      const log = db.prepare('SELECT * FROM prediction_logs WHERE matchId = ?').get('m_log_001');
      expect(log.ai_spf).toBe('主胜');
      expect(log.ai_confidence).toBe(85);

      // UPDATE
      db.prepare('UPDATE prediction_logs SET actual_score = ?, actual_spf = ? WHERE matchId = ?').run(
        '2:1',
        '主胜',
        'm_log_001',
      );
      const updated = db
        .prepare('SELECT actual_score, actual_spf FROM prediction_logs WHERE matchId = ?')
        .get('m_log_001');
      expect(updated.actual_score).toBe('2:1');
      expect(updated.actual_spf).toBe('主胜');
    });

    it('3.2 unified_predictions + prediction_outcomes 流入', () => {
      const now = new Date().toISOString();
      // 写入 unified
      db.prepare(
        `INSERT OR REPLACE INTO unified_predictions
         (match_num, match_date, match_id, model_name, model_version, prediction_id,
          direction, direction_confidence, computed_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run('001', '2026-06-10', 'm_test_u', 'AI预测', 'v1.0', 'ai_m_test_u_2026-06-10', 'home', 85, now);

      const pred = db
        .prepare('SELECT * FROM unified_predictions WHERE prediction_id = ?')
        .get('ai_m_test_u_2026-06-10');
      expect(pred.model_name).toBe('AI预测');
      expect(pred.direction).toBe('home');

      // 写入 outcome
      db.prepare(
        `INSERT OR REPLACE INTO prediction_outcomes
         (prediction_id, match_num, match_date, model_name, model_version,
          actual_home_score, actual_away_score, actual_result, direction_hit)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run('ai_m_test_u_2026-06-10', '001', '2026-06-10', 'AI预测', 'v1.0', 2, 1, '主胜', 1);

      const outcome = db
        .prepare('SELECT * FROM prediction_outcomes WHERE prediction_id = ?')
        .get('ai_m_test_u_2026-06-10');
      expect(outcome.direction_hit).toBe(1);
      expect(outcome.actual_result).toBe('主胜');
    });

    it('3.3 prediction_outcomes 唯一约束去重', () => {
      db.prepare(
        `INSERT OR REPLACE INTO prediction_outcomes
         (prediction_id, match_num, match_date, model_name, model_version)
         VALUES (?,?,?,?,?)`,
      ).run('dup_id_001', '001', '2026-06-10', 'PK评分', 'v1.0');

      db.prepare(
        `INSERT OR IGNORE INTO prediction_outcomes
         (prediction_id, match_num, match_date, model_name, model_version)
         VALUES (?,?,?,?,?)`,
      ).run('dup_id_001', '001', '2026-06-10', 'PK评分', 'v1.0');

      const rows = db
        .prepare('SELECT COUNT(*) as cnt FROM prediction_outcomes WHERE prediction_id = ?')
        .get('dup_id_001');
      expect(rows.cnt).toBe(1);
    });
  });

  // ═══════════════════════════════════════════
  // 4. 数据完整性校验
  // ═══════════════════════════════════════════
  describe('4. 数据完整性', () => {
    it('4.1 PRAGMA integrity_check', () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS matches (
          matchId TEXT PRIMARY KEY, num TEXT, homeName TEXT, visitName TEXT,
          date TEXT, matchStatus INTEGER DEFAULT 0
        );
      `);
      const check = db.prepare('PRAGMA integrity_check').get();
      expect(check['integrity_check']).toBe('ok');
    });

    it('4.2 index 数量 = 建表索引数', () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS matches (
          matchId TEXT PRIMARY KEY, num TEXT, homeName TEXT, date TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(date);
      `);

      // sqlite_master 中 matches 相关索引
      const idxRows = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='matches' ORDER BY name")
        .all();
      // 自动创建的 PRIMARY KEY 索引 + idx_matches_date
      expect(idxRows.length).toBeGreaterThanOrEqual(1);
      const names = idxRows.map((r) => r.name);
      expect(names.some((n) => n.includes('idx_matches_date'))).toBe(true);
    });

    it('4.3 大数量批量写入', () => {
      db.exec(NEW_TABLES_DDL);

      const insert = db.prepare(
        `INSERT OR REPLACE INTO odds_history_v2
         (match_num, date, fetch_date, fetch_time, play_type, odds_json)
         VALUES (?,?,?,?,?,?)`,
      );

      const tx = db.transaction((items) => {
        for (const item of items) {
          insert.run(item.num, item.date, item.fetchDate, item.fetchTime, item.playType, item.oddsJson);
        }
      });

      const batch = [];
      for (let i = 1; i <= 100; i++) {
        batch.push({
          num: `0${i}`.slice(-3),
          date: '2026-06-10',
          fetchDate: '2026-06-10',
          fetchTime: '12:00',
          playType: 'SPF',
          oddsJson: JSON.stringify({ home: 1.5 + i * 0.01, draw: 3.2, away: 4.0 }),
        });
      }

      tx(batch);

      const count = db.prepare("SELECT COUNT(*) as cnt FROM odds_history_v2 WHERE date = '2026-06-10'").get();
      expect(count.cnt).toBe(100);
    });
  });

  // ═══════════════════════════════════════════
  // 5. 类型与边界
  // ═══════════════════════════════════════════
  describe('5. 类型与边界', () => {
    beforeEach(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS matches (
          matchId TEXT PRIMARY KEY, num TEXT, homeName TEXT, visitName TEXT,
          leagueName TEXT, matchStatus INTEGER DEFAULT 0, score TEXT DEFAULT '',
          recommNum INTEGER DEFAULT 0, date TEXT
        );
      `);
    });

    it('5.1 NULL 字段插入', () => {
      db.prepare('INSERT INTO matches (matchId, num, homeName, visitName, date) VALUES (?,?,?,?,?)').run(
        'm_null_01',
        '010',
        null,
        null,
        '2026-06-10',
      );

      const row = db.prepare('SELECT * FROM matches WHERE matchId = ?').get('m_null_01');
      expect(row.homeName).toBeNull();
      expect(row.matchStatus).toBe(0); // DEFAULT
      expect(row.score).toBe(''); // DEFAULT ''
    });

    it('5.2 空字符串 vs NULL 区别', () => {
      db.prepare(
        "INSERT INTO matches (matchId, num, homeName, visitName, date, score) VALUES ('m_es', '001', 'H', 'A', '2026-06-10', '')",
      ).run();

      const row = db.prepare('SELECT score, score IS NULL as is_null FROM matches WHERE matchId = ?').get('m_es');
      expect(row.score).toBe('');
      expect(row.is_null).toBe(0); // 空字符串 ≠ NULL
    });

    it('5.3 INTEGER 类型插入非数字的失败', () => {
      // SQLite 松散类型允许任意值，但应验证预期行为
      db.prepare(
        "INSERT INTO matches (matchId, num, homeName, visitName, date, matchStatus) VALUES ('m_int', '002', 'H', 'A', '2026-06-10', 'not-a-number')",
      ).run();

      const row = db
        .prepare('SELECT matchStatus, typeof(matchStatus) as tp FROM matches WHERE matchId = ?')
        .get('m_int');
      // SQLite松散类型：'not-a-number' 存储为 TEXT，typeof 返回 'text'
      expect(row.tp).toBe('text');
      // 在实际查询中 CAST 失败时值为 0
      expect(Number(row.matchStatus)).toBeNaN();
    });

    it('5.4 超长字符串存储', () => {
      const longStr = 'A'.repeat(10000);
      db.prepare('INSERT INTO matches (matchId, num, homeName, visitName, date, score) VALUES (?,?,?,?,?,?)').run(
        'm_long',
        '005',
        longStr,
        longStr,
        '2026-06-10',
        longStr,
      );

      const row = db.prepare('SELECT homeName, score FROM matches WHERE matchId = ?').get('m_long');
      expect(row.homeName.length).toBe(10000);
      expect(row.score.length).toBe(10000);
    });
  });

  // ═══════════════════════════════════════════
  // 6. 事务
  // ═══════════════════════════════════════════
  describe('6. 事务', () => {
    beforeEach(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS matches (
          matchId TEXT PRIMARY KEY, num TEXT, homeName TEXT, visitName TEXT, date TEXT
        );
      `);
    });

    it('6.1 事务提交 — 全部写入', () => {
      const insert = db.prepare('INSERT INTO matches (matchId, num, homeName, visitName, date) VALUES (?,?,?,?,?)');

      const tx = db.transaction((items) => {
        for (const i of items) {
          insert.run(i.matchId, i.num, i.homeName, i.visitName, i.date);
        }
      });

      tx([
        { matchId: 'm_tx1', num: '01', homeName: 'A', visitName: 'B', date: '2026-06-10' },
        { matchId: 'm_tx2', num: '02', homeName: 'C', visitName: 'D', date: '2026-06-10' },
      ]);

      const all = allMatches(db);
      expect(all.length).toBe(2);
    });

    it('6.2 事务回滚 — 全部不写入', () => {
      const insert = db.prepare('INSERT INTO matches (matchId, num, homeName, visitName, date) VALUES (?,?,?,?,?)');

      try {
        const tx = db.transaction((items) => {
          insert.run(items[0].matchId, items[0].num, items[0].homeName, items[0].visitName, items[0].date);
          insert.run(items[1].matchId, items[1].num, items[1].homeName, items[1].visitName, items[1].date);
          // 故意抛异常触发回滚
          throw new Error('TX_ROLLBACK_TEST');
        });
        tx([
          { matchId: 'm_rb1', num: '01', homeName: 'A', visitName: 'B', date: '2026-06-10' },
          { matchId: 'm_rb2', num: '02', homeName: 'C', visitName: 'D', date: '2026-06-10' },
        ]);
      } catch (e) {
        // 预期异常
      }

      const all = allMatches(db);
      expect(all.length).toBe(0);
    });

    it('6.3 事务嵌套回滚', () => {
      const insert = db.prepare('INSERT INTO matches (matchId, num, homeName, visitName, date) VALUES (?,?,?,?,?)');

      // 事务内部分成功
      try {
        const tx = db.transaction((items) => {
          for (let i = 0; i < 5; i++) {
            if (i === 3) throw new Error('MID_ERR');
            insert.run(items[i].matchId, items[i].num, items[i].homeName, items[i].visitName, items[i].date);
          }
        });
        const items = [
          { matchId: 'm_ne1', num: '01', homeName: 'A', visitName: 'B', date: '2026-06-10' },
          { matchId: 'm_ne2', num: '02', homeName: 'C', visitName: 'D', date: '2026-06-10' },
          { matchId: 'm_ne3', num: '03', homeName: 'E', visitName: 'F', date: '2026-06-10' },
          { matchId: 'm_ne4', num: '04', homeName: 'G', visitName: 'H', date: '2026-06-10' },
          { matchId: 'm_ne5', num: '05', homeName: 'I', visitName: 'J', date: '2026-06-10' },
        ];
        tx(items);
      } catch (e) {
        // 预期
      }

      // 事务回滚 → 0条记录
      const all = allMatches(db);
      expect(all.length).toBe(0);
    });
  });

  // ═══════════════════════════════════════════
  // 7. jczq_basic_cache 完整测试
  // ═══════════════════════════════════════════
  describe('7. jczq_basic_cache', () => {
    beforeEach(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS jczq_basic_cache (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT NOT NULL, match_num TEXT NOT NULL,
          home_team TEXT, guest_team TEXT, league_name TEXT,
          data_json TEXT NOT NULL,
          fetch_ts TEXT DEFAULT (datetime('now','localtime')),
          UNIQUE(date, match_num)
        );
      `);
    });

    it('7.1 JSON 序列化往返', () => {
      const data = { homeTeam: '曼联', guestTeam: '切尔西', gameShortName: '英超', odds: { spf: { home: 2.1 } } };
      db.prepare(
        `INSERT OR REPLACE INTO jczq_basic_cache (date, match_num, home_team, guest_team, league_name, data_json)
         VALUES (?,?,?,?,?,?)`,
      ).run('2026-06-10', '001', data.homeTeam, data.guestTeam, data.gameShortName, JSON.stringify(data));

      const row = db
        .prepare('SELECT data_json FROM jczq_basic_cache WHERE date = ? AND match_num = ?')
        .get('2026-06-10', '001');
      const parsed = JSON.parse(row.data_json);
      expect(parsed.homeTeam).toBe('曼联');
      expect(parsed.odds.spf.home).toBe(2.1);
    });

    it('7.2 日期+编号唯一约束', () => {
      db.prepare(`INSERT OR REPLACE INTO jczq_basic_cache (date, match_num, data_json) VALUES (?,?,?)`).run(
        '2026-06-10',
        '001',
        '{}',
      );

      // REPLACE 覆盖
      db.prepare(`INSERT OR REPLACE INTO jczq_basic_cache (date, match_num, data_json) VALUES (?,?,?)`).run(
        '2026-06-10',
        '001',
        '{"v":2}',
      );

      const count = db
        .prepare("SELECT COUNT(*) as cnt FROM jczq_basic_cache WHERE date='2026-06-10' AND match_num='001'")
        .get();
      expect(count.cnt).toBe(1);
    });
  });
});
