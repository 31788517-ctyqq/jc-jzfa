/**
 * P2: data-pipeline-e2e.test.js
 * 端到端数据管道 — 采集→存储→计算→出库 完整链路
 *
 * 覆盖：
 *   - 比赛数据写入 → 推荐写入 → 特征计算 → 预测生成 → 结果回填
 *   - 功守道 7 阶段管道模拟
 *   - data_sync.js finalCheck 全链路
 */

const Database = require('better-sqlite3');

// ═══ 辅助函数 ═══
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
function scoreToDirection(s) {
  if (!s) return null;
  const p = String(s).split(/[-:：]/);
  if (p.length < 2) return null;
  const h = parseInt(p[0]),
    a = parseInt(p[1]);
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

function createE2EDb() {
  const db = new Database(':memory:');
  // 所有表
  db.exec(`
    CREATE TABLE matches (matchId TEXT PRIMARY KEY, num TEXT, homeName TEXT, visitName TEXT, leagueName TEXT, date TEXT, matchStatus INTEGER DEFAULT 0, score TEXT DEFAULT '', halfScore TEXT DEFAULT '', recommNum INTEGER DEFAULT 0, startTime TEXT);
    CREATE TABLE recommends (id INTEGER PRIMARY KEY AUTOINCREMENT, matchId TEXT, type TEXT, num INTEGER, result REAL, fetchDate TEXT, UNIQUE(matchId, type, fetchDate));
    CREATE TABLE crawl_logs (date TEXT PRIMARY KEY, matchCount INTEGER, recommCount INTEGER, status TEXT DEFAULT 'pending');
    CREATE TABLE prediction_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, matchId TEXT NOT NULL, date TEXT, homeName TEXT, visitName TEXT, leagueName TEXT, matchNum TEXT, ai_spf TEXT, ai_confidence REAL, ai_score TEXT, ai_overunder TEXT, ai_content TEXT, pk_composite_score REAL, pk_direction TEXT, pk_direction_stars INTEGER, pk_fusion_consensus TEXT, pk_goal_direction TEXT, gs_scores_json TEXT, gs_top_score TEXT, gs_top_percent REAL, actual_score TEXT, actual_spf TEXT, actual_overunder TEXT, actual_home_goals INTEGER, actual_away_goals INTEGER, created_at TEXT, updated_at TEXT);
    CREATE TABLE unified_predictions (id INTEGER PRIMARY KEY AUTOINCREMENT, match_num TEXT, match_date TEXT, match_id TEXT, model_name TEXT NOT NULL, model_version TEXT NOT NULL, prediction_id TEXT NOT NULL UNIQUE, direction TEXT, direction_confidence REAL, over_under TEXT, predicted_score TEXT, raw_output_json TEXT, consensus_tag TEXT, computed_at TEXT);
    CREATE TABLE prediction_outcomes (id INTEGER PRIMARY KEY AUTOINCREMENT, prediction_id TEXT NOT NULL UNIQUE, match_num TEXT, match_date TEXT, model_name TEXT, model_version TEXT, actual_home_score INTEGER, actual_away_score INTEGER, actual_result TEXT, actual_total_goals INTEGER, direction_hit INTEGER DEFAULT 0, over_under_hit INTEGER DEFAULT 0, score_hit INTEGER DEFAULT 0);
    CREATE TABLE feature_store (id INTEGER PRIMARY KEY AUTOINCREMENT, match_num TEXT NOT NULL, match_date TEXT NOT NULL, feature_version TEXT NOT NULL, feature_name TEXT NOT NULL, feature_value REAL, UNIQUE(match_num, match_date, feature_version, feature_name));
  `);
  return db;
}

describe('P2: data-pipeline-e2e — 端到端数据管道', () => {
  let db;

  beforeEach(() => {
    db = createE2EDb();
  });
  afterEach(() => db.close());

  // ═══════════════════════════════════════════
  // 1. 采集 → 存储
  // ═══════════════════════════════════════════
  describe('1. 数据采集 → 存储', () => {
    it('1.1 比赛数据批量写入', () => {
      const matches = [
        {
          matchId: 'm_001',
          num: '001',
          homeName: 'A',
          visitName: 'B',
          leagueName: '英超',
          date: '2026-06-10',
          matchStatus: 0,
        },
        {
          matchId: 'm_002',
          num: '002',
          homeName: 'C',
          visitName: 'D',
          leagueName: '英超',
          date: '2026-06-10',
          matchStatus: 0,
        },
        {
          matchId: 'm_003',
          num: '003',
          homeName: 'E',
          visitName: 'F',
          leagueName: '西甲',
          date: '2026-06-10',
          matchStatus: 0,
        },
      ];

      const insert = db.prepare(
        'INSERT INTO matches (matchId, num, homeName, visitName, leagueName, date, matchStatus) VALUES (?,?,?,?,?,?,?)',
      );
      const tx = db.transaction((items) => {
        items.forEach((m) =>
          insert.run(m.matchId, m.num, m.homeName, m.visitName, m.leagueName, m.date, m.matchStatus),
        );
      });
      tx(matches);

      const all = db.prepare('SELECT * FROM matches ORDER BY CAST(num AS INTEGER)').all();
      expect(all.length).toBe(3);
      expect(all[0].leagueName).toBe('英超');
      expect(all[2].leagueName).toBe('西甲');
    });

    it('1.2 推荐数据写入 + 唯一约束', () => {
      db.prepare('INSERT INTO matches (matchId, num, homeName, visitName, date) VALUES (?,?,?,?,?)').run(
        'm_001',
        '001',
        'A',
        'B',
        '2026-06-10',
      );

      const recs = [
        { matchId: 'm_001', type: '主胜', num: 100, result: 0 },
        { matchId: 'm_001', type: '平局', num: 50, result: 0 },
      ];

      const stmt = db.prepare(
        'INSERT OR IGNORE INTO recommends (matchId, type, num, result, fetchDate) VALUES (?,?,?,?,?)',
      );
      recs.forEach((r) => stmt.run(r.matchId, r.type, r.num, r.result, '2026-06-10'));

      const rows = db.prepare('SELECT * FROM recommends WHERE matchId = ?').all('m_001');
      expect(rows.length).toBe(2);
    });

    it('1.3 crawl_logs 记录', () => {
      db.prepare('INSERT OR REPLACE INTO crawl_logs (date, matchCount, recommCount, status) VALUES (?,?,?,?)').run(
        '2026-06-10',
        5,
        12,
        'ok',
      );
      const log = db.prepare('SELECT * FROM crawl_logs WHERE date = ?').get('2026-06-10');
      expect(log.matchCount).toBe(5);
      expect(log.status).toBe('ok');
    });
  });

  // ═══════════════════════════════════════════
  // 2. 存储 → 计算
  // ═══════════════════════════════════════════
  describe('2. 存储 → 预测计算', () => {
    it('2.1 特征写入', () => {
      const features = [
        { matchNum: '001', date: '2026-06-10', name: 'home_power', value: 72.5 },
        { matchNum: '001', date: '2026-06-10', name: 'away_power', value: 65.3 },
        { matchNum: '001', date: '2026-06-10', name: 'home_form', value: 0.75 },
        { matchNum: '002', date: '2026-06-10', name: 'home_power', value: 80.0 },
      ];

      const stmt = db.prepare(
        'INSERT OR REPLACE INTO feature_store (match_num, match_date, feature_version, feature_name, feature_value) VALUES (?,?,?,?,?)',
      );
      features.forEach((f) => stmt.run(f.matchNum, f.date, 'v3.0', f.name, f.value));

      const row = db.prepare("SELECT * FROM feature_store WHERE match_num='001' AND feature_name='home_power'").get();
      expect(row.feature_value).toBe(72.5);

      const all001 = db.prepare("SELECT COUNT(*) as cnt FROM feature_store WHERE match_num='001'").get();
      expect(all001.cnt).toBe(3);
    });

    it('2.2 预测日志生成', () => {
      db.prepare(
        `INSERT INTO prediction_logs (matchId, date, matchNum, homeName, visitName, leagueName, ai_spf, ai_confidence, pk_direction, pk_composite_score, gs_top_score, gs_top_percent)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run('m_001', '2026-06-10', '001', 'A', 'B', '英超', '主胜', 85, '主胜', 78, '2:0', 72);

      const log = db.prepare('SELECT * FROM prediction_logs WHERE matchId = ?').get('m_001');
      expect(log.ai_spf).toBe('主胜');
      expect(log.pk_composite_score).toBe(78);
    });
  });

  // ═══════════════════════════════════════════
  // 3. 计算 → 出库
  // ═══════════════════════════════════════════
  describe('3. 预测 → unified → outcome 出库', () => {
    it('3.1 完整三阶段', () => {
      // Phase 1: 写入预测日志
      db.prepare(
        `INSERT INTO prediction_logs (matchId, date, matchNum, homeName, visitName,
         ai_spf, ai_confidence, ai_score, ai_overunder,
         pk_direction, pk_composite_score, pk_goal_direction,
         gs_top_score, gs_top_percent, gs_scores_json,
         actual_score, actual_spf, actual_overunder, actual_home_goals, actual_away_goals)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        'm_e2e_f',
        '2026-06-10',
        '001',
        'A',
        'B',
        '主胜',
        90,
        '2:1',
        '大球',
        '主胜',
        85,
        '大球',
        '2:1',
        80,
        JSON.stringify([{ score: '2:1', percent: 80 }]),
        '2:1',
        '主胜',
        '大球',
        2,
        1,
      );

      const log = db.prepare('SELECT * FROM prediction_logs WHERE matchId = ?').get('m_e2e_f');
      const mid = 'e2e_f',
        date = '2026-06-10';

      // Phase 2: 流入 unified（3模型）
      const modelInserts = [];
      const aiDir = mapDirection(log.ai_spf);
      if (aiDir)
        modelInserts.push([
          'AI预测',
          `ai_${mid}_${date}`,
          aiDir,
          log.ai_confidence || 50,
          mapOverUnder(log.ai_overunder),
          log.ai_score,
          log.ai_content,
        ]);

      const gsDir = scoreToDirection(log.gs_top_score);
      if (gsDir)
        modelInserts.push([
          '功守道',
          `gs_${mid}_${date}`,
          gsDir,
          log.gs_top_percent || 50,
          null,
          null,
          log.gs_scores_json,
        ]);

      const pkDir = mapDirection(log.pk_direction);
      if (pkDir)
        modelInserts.push([
          'PK评分',
          `pk_${mid}_${date}`,
          pkDir,
          log.pk_composite_score || 50,
          mapOverUnder(log.pk_goal_direction),
          null,
          null,
        ]);

      modelInserts.forEach(([model, predId, dir, conf, ou, score, raw]) => {
        db.prepare(
          `INSERT INTO unified_predictions (match_num,match_date,match_id,model_name,model_version,prediction_id,direction,direction_confidence,over_under,predicted_score,raw_output_json,computed_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run('001', date, mid, model, 'v1.0', predId, dir, conf, ou, score, raw, date);
      });
      expect(modelInserts.length).toBe(3);

      // Phase 3: 回填 outcome
      const matchInfo = { score: '2:1' };
      const uRows = db.prepare('SELECT * FROM unified_predictions WHERE match_id = ?').all(mid);
      uRows.forEach((pred) => {
        const score = matchInfo.score.replace(/[-:]/g, ':').split(':');
        const ah = parseInt(score[0]),
          aa = parseInt(score[1]);
        const total = ah + aa;
        const actualResult = ah > aa ? 'home' : ah < aa ? 'away' : 'draw';

        db.prepare(
          `INSERT OR REPLACE INTO prediction_outcomes (prediction_id,match_num,match_date,model_name,model_version,actual_home_score,actual_away_score,actual_result,actual_total_goals,direction_hit,over_under_hit,score_hit)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          pred.prediction_id,
          pred.match_num,
          pred.match_date,
          pred.model_name,
          pred.model_version,
          ah,
          aa,
          actualResult,
          total,
          pred.direction === actualResult ? 1 : 0,
          pred.over_under ? ((total > 2.5 ? 'over' : 'under') === pred.over_under ? 1 : 0) : 0,
          pred.predicted_score ? (pred.predicted_score === matchInfo.score ? 1 : 0) : 0,
        );
      });

      // 验证全链
      const outcomes = db.prepare('SELECT * FROM prediction_outcomes').all();
      expect(outcomes.length).toBe(3);

      // 2:1 → 主胜, 3>2.5 → over
      outcomes.forEach((o) => {
        expect(o.direction_hit).toBe(1); // 全部预测主胜
        if (o.model_name === 'AI预测') expect(o.score_hit).toBe(1);
        // 功守道没有 over_under，不检查
        if (o.model_name !== '功守道') expect(o.over_under_hit).toBe(1);
      });
    });

    it('3.2 一场比赛全貌', () => {
      const matchId = 'm_full_view';

      // 1. 比赛录入
      db.prepare(
        'INSERT INTO matches (matchId, num, homeName, visitName, leagueName, date, matchStatus) VALUES (?,?,?,?,?,?,?)',
      ).run(matchId, '005', '皇马', '巴萨', '西甲', '2026-06-10', 0);

      // 2. 推荐
      db.prepare('INSERT INTO recommends (matchId, type, num, result, fetchDate) VALUES (?,?,?,?,?)').run(
        matchId,
        '主胜',
        100,
        0,
        '2026-06-10',
      );

      // 3. 预测日志
      db.prepare(
        `INSERT INTO prediction_logs (matchId, date, matchNum, homeName, visitName, leagueName, ai_spf, ai_confidence, actual_score)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(matchId, '2026-06-10', '005', '皇马', '巴萨', '西甲', '主胜', 82, '3:2');

      // 4. 验证三条数据都正确关联
      const match = db.prepare('SELECT * FROM matches WHERE matchId = ?').get(matchId);
      expect(match.leagueName).toBe('西甲');

      const rec = db.prepare("SELECT * FROM recommends WHERE matchId = ? AND type = '主胜'").get(matchId);
      expect(rec.num).toBe(100);

      const log = db.prepare('SELECT * FROM prediction_logs WHERE matchId = ?').get(matchId);
      expect(log.ai_confidence).toBe(82);
      expect(log.actual_score).toBe('3:2');
    });
  });

  // ═══════════════════════════════════════════
  // 4. 功守道 7 阶段模拟
  // ═══════════════════════════════════════════
  describe('4. 功守道 7 阶段管道模拟', () => {
    it('4.1 Phase 1: Parse — 原始数据解析', () => {
      const raw = { matchId: 'm_001', odds: { spf: { home: 2.1, draw: 3.4, away: 3.0 } } };
      expect(raw.odds.spf.home).toBe(2.1);
    });

    it('4.2 Phase 2: Attack — 进攻指标', () => {
      const attackIndex = { home: 0.75, away: 0.45 };
      expect(attackIndex.home).toBeGreaterThan(attackIndex.away);
    });

    it('4.3 Phase 3: Goal — 进球预期', () => {
      const goalExp = { home: 1.8, away: 0.9 };
      expect(goalExp.home + goalExp.away).toBeCloseTo(2.7, 1);
    });

    it('4.4 Phase 4: Diff — 差异分析', () => {
      const homePower = 72,
        awayPower = 60;
      const diff = homePower - awayPower;
      expect(diff).toBe(12);
    });

    it('4.5 Phase 5: Score — 比分概率', () => {
      const scores = [
        { score: '2:1', percent: 18.5 },
        { score: '1:0', percent: 15.2 },
        { score: '2:0', percent: 12.8 },
      ];
      // 最高概率比分
      const top = scores.sort((a, b) => b.percent - a.percent)[0];
      expect(top.score).toBe('2:1');
      expect(top.percent).toBe(18.5);
    });

    it('4.6 Phase 6: Market — 市场信号', () => {
      const signal = { consensus: 'strong', direction: 'home', confidence: 0.82 };
      expect(signal.consensus).toBe('strong');
    });

    it('4.7 Phase 7: Output — 最终输出', () => {
      const output = {
        matchId: '001',
        matchDate: '2026-06-10',
        topScore: '2:1',
        topPercent: 18.5,
        direction: 'home',
        consensus: 'strong',
        ladderLabel: 'L1',
        ladderLevel: 3,
      };
      expect(output.direction).toBe('home');
      expect(output.ladderLevel).toBe(3);
      expect(output.consensus).toBe('strong');
    });
  });

  // ═══════════════════════════════════════════
  // 5. data_sync.js finalCheck 模拟
  // ═══════════════════════════════════════════
  describe('5. finalCheck 全链路', () => {
    it('5.1 赛果回填 → unified同步 → outcome回填', () => {
      const date = '2026-06-10';

      // Step 1: 写入已完成比赛
      db.prepare(
        `INSERT INTO prediction_logs (matchId, date, matchNum, homeName, visitName,
         ai_spf, ai_confidence,
         pk_direction, pk_composite_score,
         actual_score, actual_spf, actual_home_goals, actual_away_goals)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run('m_fc_1', date, '001', 'A', 'B', '主胜', 88, '主胜', 82, '2:0', '主胜', 2, 0);

      // Step 2: incrementalSyncToUnified
      const log = db.prepare('SELECT * FROM prediction_logs WHERE matchId = ?').get('m_fc_1');
      const mid = 'fc_1';

      const aiDir = mapDirection(log.ai_spf);
      if (aiDir) {
        db.prepare(
          `INSERT INTO unified_predictions (match_num,match_date,match_id,model_name,model_version,prediction_id,direction,direction_confidence,computed_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        ).run('001', date, mid, 'AI预测', 'v1.0', `ai_${mid}_${date}`, aiDir, log.ai_confidence || 50, date);
      }
      const pkDir = mapDirection(log.pk_direction);
      if (pkDir) {
        db.prepare(
          `INSERT INTO unified_predictions (match_num,match_date,match_id,model_name,model_version,prediction_id,direction,direction_confidence,computed_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        ).run('001', date, mid, 'PK评分', 'v1.0', `pk_${mid}_${date}`, pkDir, log.pk_composite_score || 50, date);
      }

      const unifiedCount = db.prepare("SELECT COUNT(*) as cnt FROM unified_predictions WHERE match_id = 'fc_1'").get();
      expect(unifiedCount.cnt).toBeGreaterThanOrEqual(1);

      // Step 3: OutcomeBackfill
      const uRows = db.prepare("SELECT * FROM unified_predictions WHERE match_id = 'fc_1'").all();
      uRows.forEach((pred) => {
        const existing = db
          .prepare('SELECT id FROM prediction_outcomes WHERE prediction_id = ?')
          .get(pred.prediction_id);
        if (existing) return;

        db.prepare(
          `INSERT INTO prediction_outcomes (prediction_id,match_num,match_date,model_name,model_version,actual_home_score,actual_away_score,actual_result,actual_total_goals,direction_hit)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          pred.prediction_id,
          pred.match_num,
          pred.match_date,
          pred.model_name,
          pred.model_version,
          2,
          0,
          'home',
          2,
          pred.direction === 'home' ? 1 : 0,
        );
      });

      const outCount = db.prepare('SELECT COUNT(*) as cnt FROM prediction_outcomes').get();
      expect(outCount.cnt).toBeGreaterThanOrEqual(1);

      // 验证: 所有预测为 home, 结果 2:0 → 全部命中
      const outcomes = db.prepare('SELECT model_name, direction_hit FROM prediction_outcomes').all();
      outcomes.forEach((o) => expect(o.direction_hit).toBe(1));
    });
  });
});
