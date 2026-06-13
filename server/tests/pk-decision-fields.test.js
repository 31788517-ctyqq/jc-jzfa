const database = require('../database');
const predictionLog = require('../prediction_log');

jest.mock('../database', () => {
  const columns = new Set([
    'id',
    'matchId',
    'pk_final_direction',
    'pk_decision_level',
    'pk_risk_level',
    'pk_risk_tags_json',
    'pk_degrade_reasons_json',
    'pk_decision_narrative',
  ]);
  const rows = [];
  const adp = {
    execRun: jest.fn(function (sql, ...params) {
      if (sql.indexOf('ALTER TABLE prediction_logs ADD COLUMN') === 0) {
        const m = sql.match(/ADD COLUMN\s+(\w+)/);
        if (m) columns.add(m[1]);
      }
      if (sql.indexOf('CREATE TABLE') === 0 || sql.indexOf('CREATE INDEX') === 0 || sql.indexOf('ALTER TABLE') === 0)
        return true;
      if (sql.indexOf('INSERT INTO prediction_logs') === 0) {
        rows.push({ sql, params });
        return true;
      }
      if (sql.indexOf('UPDATE prediction_logs SET') === 0) {
        rows.push({ sql, params });
        return true;
      }
      return true;
    }),
    execOne: jest.fn(function () {
      return null;
    }),
    execAll: jest.fn(function (sql) {
      if (sql.indexOf('PRAGMA table_info(prediction_logs)') === 0) {
        return Array.from(columns).map(function (name) {
          return { name };
        });
      }
      return [];
    }),
    transaction: null,
  };
  return {
    initDatabase: jest.fn(),
    isAvailable: jest.fn(function () {
      return true;
    }),
    getAdapter: jest.fn(function () {
      return adp;
    }),
    __rows: rows,
    __adp: adp,
  };
});

describe('prediction_log — M2 PK 裁判标准字段持久化', () => {
  beforeAll(async () => {
    await predictionLog.asyncEnsure();
  });

  beforeEach(() => {
    database.__rows.length = 0;
    database.__adp.execRun.mockClear();
  });

  it('upsertPK 写入 finalDirection/decisionLevel/risk/degrade/narrative 字段', () => {
    const ok = predictionLog.upsertPK('m-test-1', {
      finalDirection: '主胜',
      decisionLevel: '可做',
      riskLevel: 'yellow',
      riskTags: ['负期望'],
      degradeReasons: ['EV 为负，不升为主推'],
      decisionNarrative: 'PK裁判：主胜，评级可做，风险中。',
    });

    expect(ok).not.toBe(false);
    const insert = database.__rows[0];
    expect(insert.sql).toContain('pk_final_direction');
    expect(insert.sql).toContain('pk_decision_level');
    expect(insert.sql).toContain('pk_risk_level');
    expect(insert.sql).toContain('pk_risk_tags_json');
    expect(insert.sql).toContain('pk_degrade_reasons_json');
    expect(insert.sql).toContain('pk_decision_narrative');
    expect(insert.params).toContain('主胜');
    expect(insert.params).toContain('可做');
    expect(insert.params).toContain('yellow');
    expect(insert.params).toContain(JSON.stringify(['负期望']));
    expect(insert.params).toContain(JSON.stringify(['EV 为负，不升为主推']));
  });
});
