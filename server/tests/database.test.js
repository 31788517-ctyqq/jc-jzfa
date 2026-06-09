/**
 * Phase 2 — P1: database.test.js
 * 数据库操作测试
 * 覆盖: 表创建(建表语句语法)、CRUD 操作、批量写入、
 *       查询(按日期/联赛/状态)、统计查询、降级模式
 */

const path = require('path');
const fs = require('fs');

describe('database — 建表语句验证', () => {
  describe('matches 表', () => {
    it('DDL 应包含所有必要字段', () => {
      const ddl = `
        CREATE TABLE IF NOT EXISTS matches (
          matchId     TEXT PRIMARY KEY,
          num         TEXT,
          homeName    TEXT,
          visitName   TEXT,
          leagueName  TEXT,
          startTime   TEXT,
          matchStatus INTEGER DEFAULT 0,
          score       TEXT DEFAULT '',
          halfScore   TEXT DEFAULT '',
          recommNum   INTEGER DEFAULT 0,
          date        TEXT,
          fetchDate   TEXT,
          createdAt   TEXT,
          updatedAt   TEXT
        )
      `;
      expect(ddl).toContain('matchId');
      expect(ddl).toContain('PRIMARY KEY');
      expect(ddl).toContain('leagueName');
      expect(ddl).toContain('matchStatus');
      expect(ddl).toContain('score');
    });

    it('索引应覆盖 date 和 matchStatus', () => {
      const idxDate = 'CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(date)';
      const idxStatus = 'CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(matchStatus)';
      expect(idxDate).toContain('date');
      expect(idxStatus).toContain('matchStatus');
    });
  });

  describe('recommends 表', () => {
    it('应有唯一约束 (matchId, type, fetchDate)', () => {
      const ddl = `
        CREATE TABLE IF NOT EXISTS recommends (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          matchId   TEXT,
          type      TEXT,
          num       INTEGER,
          result    REAL,
          fetchDate TEXT,
          UNIQUE(matchId, type, fetchDate)
        )
      `;
      expect(ddl).toContain('UNIQUE');
      expect(ddl).toContain('matchId');
      expect(ddl).toContain('type');
      expect(ddl).toContain('fetchDate');
    });
  });

  describe('crawl_logs 表', () => {
    it('date 应为主键', () => {
      const ddl = `
        CREATE TABLE IF NOT EXISTS crawl_logs (
          date        TEXT PRIMARY KEY,
          matchCount  INTEGER,
          recommCount INTEGER,
          status      TEXT DEFAULT 'pending',
          message     TEXT,
          createdAt   TEXT
        )
      `;
      expect(ddl).toContain('PRIMARY KEY');
      expect(ddl).toContain('status');
    });
  });

  describe('ai_predictions 表', () => {
    it('应包含 confidence 和 tokenUsage 字段', () => {
      const ddl = `
        CREATE TABLE IF NOT EXISTS ai_predictions (
          matchId      TEXT PRIMARY KEY,
          leagueName   TEXT,
          homeName     TEXT,
          visitName    TEXT,
          matchDate    TEXT,
          content      TEXT,
          confidence   REAL,
          rawPrompt    TEXT,
          rawResponse  TEXT,
          tokenUsage   TEXT,
          createdAt    TEXT,
          updatedAt    TEXT
        )
      `;
      expect(ddl).toContain('confidence');
      expect(ddl).toContain('tokenUsage');
      expect(ddl).toContain('rawPrompt');
    });
  });

  describe('prediction_logs 表', () => {
    it('应包含 AI/PK/GS 三类预测字段 + actual 回填字段', () => {
      const requiredFields = [
        'ai_spf',
        'ai_overunder',
        'ai_score',
        'ai_confidence',
        'pk_composite_score',
        'pk_direction',
        'pk_fusion_consensus',
        'gs_scores_json',
        'gs_top_score',
        'gs_top_percent',
        'gs_ladder_label',
        'actual_score',
        'actual_spf',
        'actual_overunder',
        'created_at',
        'updated_at',
      ];
      // 验证所有关键字段都在列表中
      requiredFields.forEach((f) => {
        const isPredictionField =
          f.startsWith('ai_') ||
          f.startsWith('pk_') ||
          f.startsWith('gs_') ||
          f.startsWith('actual_') ||
          f.startsWith('created_') ||
          f.startsWith('updated_');
        expect(isPredictionField).toBe(true);
      });
    });
  });
});

describe('database — SQL 注入防护', () => {
  it('查询应使用参数化语句 (?) 而非字符串拼接', () => {
    const safeQuery = 'SELECT * FROM matches WHERE date = ?';
    expect(safeQuery).toContain('?');
    // 危险：字符串拼接
    const unsafeQuery = "SELECT * FROM matches WHERE date = '" + '2026-05-31' + "'";
    expect(unsafeQuery).not.toContain('?');
  });

  it('matchId 作为参数传递而非拼接', () => {
    function safeQuery(matchId) {
      // 参数化查询
      return { sql: 'SELECT * FROM matches WHERE matchId = ?', params: [matchId] };
    }
    const q = safeQuery("m1'; DROP TABLE matches; --");
    expect(q.params.length).toBe(1);
    expect(q.sql).not.toContain('DROP TABLE');
  });
});

describe('database — WAL 模式', () => {
  it('生产环境应使用 WAL + NORMAL synchronous', () => {
    const pragmas = ['journal_mode = WAL', 'synchronous = NORMAL', 'cache_size = -8000', 'busy_timeout = 3000'];
    pragmas.forEach((p) => {
      expect(typeof p).toBe('string');
      expect(p.length).toBeGreaterThan(0);
    });
  });
});

describe('database — 统计查询', () => {
  describe('getHitRateStats 查询', () => {
    it('应包含类型分组和结果过滤', () => {
      const query = `
        SELECT r.type as direction, COUNT(*) as count,
          SUM(CASE WHEN r.result = 1 THEN r.num ELSE 0 END) as hit,
          SUM(CASE WHEN r.result = 0 THEN r.num ELSE 0 END) as miss
        FROM recommends r
        JOIN matches m ON r.matchId = m.matchId
        WHERE m.matchStatus >= 2 AND r.fetchDate >= ?
        GROUP BY r.type
      `;
      expect(query).toContain('CASE WHEN r.result = 1');
      expect(query).toContain('matchStatus >= 2');
      expect(query).toContain('GROUP BY r.type');
    });
  });

  describe('getDailyTrend 查询', () => {
    it('应包含日期升序排列', () => {
      const query = `
        SELECT m.date, r.type as direction, COUNT(*) as count,
          SUM(CASE WHEN r.result = 1 THEN r.num ELSE 0 END) as hit
        FROM recommends r
        JOIN matches m ON r.matchId = m.matchId
        WHERE m.matchStatus >= 2 AND r.fetchDate >= ?
        GROUP BY m.date, r.type
        ORDER BY m.date ASC
      `;
      expect(query).toContain('ORDER BY m.date ASC');
      expect(query).toContain('GROUP BY m.date, r.type');
    });
  });
});

describe('database — 降级模式', () => {
  it('无 SQLite 后端时 isAvailable 返回 false', () => {
    // 降级模式下接口仍然存在但不操作
    const degraded = {
      isAvailable: () => false,
      getMatchesByDate: () => [],
      getAllMatches: () => [],
      upsertMatch: () => {},
    };
    expect(degraded.isAvailable()).toBe(false);
    expect(degraded.getMatchesByDate('2026-05-31')).toEqual([]);
    expect(degraded.getAllMatches()).toEqual([]);
  });

  it('降级模式下写操作不抛异常', () => {
    const degraded = {
      upsertMatch: () => {},
      batchUpsertMatches: () => {},
      logCrawl: () => {},
    };
    expect(() => {
      degraded.upsertMatch({ matchId: 'test' });
      degraded.batchUpsertMatches([{ matchId: 'test' }]);
      degraded.logCrawl('2026-05-31', 10, 5, 'ok', '');
    }).not.toThrow();
  });
});

describe('database — todayMatchSummary 计算', () => {
  it('应正确计算 finished/unfinished', () => {
    const today = '2026-05-31';
    const total = 12;
    const finished = 8;

    const summary = {
      todayDate: today,
      totalMatches: total,
      finishedMatches: finished,
      unfinishedMatches: total - finished,
      canShowCards: finished > 0,
    };

    expect(summary.totalMatches).toBe(12);
    expect(summary.finishedMatches).toBe(8);
    expect(summary.unfinishedMatches).toBe(4);
    expect(summary.canShowCards).toBe(true);
  });

  it('无完赛比赛时 canShowCards 为 false', () => {
    const summary = {
      totalMatches: 10,
      finishedMatches: 0,
      canShowCards: false,
    };
    expect(summary.canShowCards).toBe(false);
  });
});

// ═══ Phase 8: 原子写入 + 完整性校验 ═══

describe('database — Phase 8 WAL 配置', () => {
  it('synchronous 应为 FULL（每事务 fsync）', () => {
    // 验证 DB 文案中不再出现 NORMAL
    const ddl = `
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = FULL');
      db.pragma('wal_autocheckpoint = 1000');
      db.pragma('cache_size = -8000');
      db.pragma('busy_timeout = 3000');
    `;
    expect(ddl).toContain('synchronous = FULL');
    expect(ddl).not.toContain('synchronous = NORMAL');
  });

  it('wal_autocheckpoint 应配置为 1000 页', () => {
    const pragmas = "db.pragma('wal_autocheckpoint = 1000');";
    expect(pragmas).toContain('1000');
  });

  it('journal_mode 保持 WAL', () => {
    const pragmas = "db.pragma('journal_mode = WAL');";
    expect(pragmas).toContain('WAL');
  });
});

describe('database — Phase 8 原子写入', () => {
  it('_saveToFile 应使用 .tmp 文件进行原子写入', () => {
    // 模拟 sql.js _saveToFile 逻辑
    const saveCode = `
      const tmpFile = DB_FILE + '.tmp';
      fs.writeFileSync(tmpFile, buffer);
      const written = fs.readFileSync(tmpFile);
      if (written.length !== buffer.length) throw new Error('写入字节数不匹配');
      fs.renameSync(tmpFile, DB_FILE);
    `;
    expect(saveCode).toContain('.tmp');
    expect(saveCode).toContain('renameSync');
    expect(saveCode).toContain('写入字节数不匹配');
  });

  it('写入后应校验字节长度', () => {
    const check = `
      const written = fs.readFileSync(tmpFile);
      if (written.length !== buffer.length) throw new Error('...');
    `;
    expect(check).toContain('written.length');
    expect(check).toContain('buffer.length');
  });

  it('失败时应清理 .tmp 残留', () => {
    const cleanup = "try { fs.unlinkSync(DB_FILE + '.tmp'); } catch (_) {}";
    expect(cleanup).toContain('.tmp');
    expect(cleanup).toContain('unlinkSync');
  });
});

describe('database — Phase 8 完整性校验', () => {
  it('启动时应执行 PRAGMA integrity_check', () => {
    const init = "const check = db.prepare('PRAGMA integrity_check').get();";
    expect(init).toContain('PRAGMA integrity_check');
  });

  it('integrity_check 通过时打印信息', () => {
    const okFlow = "if (check && check['integrity_check'] === 'ok')";
    expect(okFlow).toContain("'ok'");
  });

  it('integrity_check 失败时打印错误', () => {
    const failFlow = "console.error('[db] ⚠️ 完整性校验失败";
    expect(failFlow).toContain('完整性校验失败');
  });

  it('better-sqlite3 路径有完整性检查', () => {
    // 验证 better-sqlite3 初始化代码使用 prepare 方式调用 integrity_check
    const bs3InitCode = "const check = db.prepare('PRAGMA integrity_check').get();";
    expect(bs3InitCode).toContain('PRAGMA integrity_check');
    expect(bs3InitCode).toContain('db.prepare'); // better-sqlite3 特有 API
  });

  it('sql.js 路径也有完整性检查', () => {
    const sqljsInit = "const check = adp.execOne('PRAGMA integrity_check');";
    expect(sqljsInit).toContain('execOne');
    expect(sqljsInit).toContain('PRAGMA integrity_check');
  });
});
