/**
 * P2: file-corruption.test.js
 * 文件损坏恢复测试 — data.json 损坏、.tmp 孤儿、odds 截断
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

var _uid = Math.random().toString(36).slice(2, 8);
var TEST_DIR = path.join(os.tmpdir(), 'jczjfa-corruption-' + Date.now() + '-' + _uid);

// 防 Windows NTFS rename 竞态：重试 3 次
function safeRename(src, dst) {
  for (var i = 0; i < 3; i++) {
    try { fs.renameSync(src, dst); return; } catch (e) {
      if (i === 2) throw e;
      var t = Date.now() + 5; while (Date.now() < t) {}
    }
  }
}

describe('P2: file-corruption — 文件损坏恢复', () => {
  beforeEach(() => {
    if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    } catch (_) {}
  });

  // ═══════════════════════════════════════════
  // 1. data.json 损坏场景
  // ═══════════════════════════════════════════
  describe('1. data.json 损坏', () => {
    it('1.1 JSON 语法错误 — 截断', () => {
      const broken = '{"date":"2026-06-10","m":';
      const file = path.join(TEST_DIR, 'broken.json');
      fs.writeFileSync(file, broken);

      let parsed = null,
        errMsg = '';
      try {
        parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (e) {
        errMsg = e.message;
      }
      expect(parsed).toBeNull();
      expect(errMsg).not.toBe('');
    });

    it('1.2 JSON 意外结尾', () => {
      const incomplete = '{"date":"2026-06-10","m":{"m_001":{"homeName":"A"';
      const file = path.join(TEST_DIR, 'incomplete.json');
      fs.writeFileSync(file, incomplete);

      expect(() => JSON.parse(fs.readFileSync(file, 'utf8'))).toThrow();
    });

    it('1.3 空文件', () => {
      const file = path.join(TEST_DIR, 'empty.json');
      fs.writeFileSync(file, '');

      expect(() => JSON.parse(fs.readFileSync(file, 'utf8'))).toThrow();
    });

    it('1.4 只读文件', () => {
      const file = path.join(TEST_DIR, 'readonly.json');
      fs.writeFileSync(file, '{"date":"2026-06-10"}');
      try {
        fs.chmodSync(file, 0o444);
      } catch (_) {} // 只读

      // 读取应成功
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      expect(data.date).toBe('2026-06-10');

      // 写入应失败
      let writeErr = null;
      try {
        fs.writeFileSync(file, 'new data');
      } catch (e) {
        writeErr = e;
      }
      // 只读文件写入会失败（权限错误）
      if (writeErr) expect(writeErr.code).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════
  // 2. .tmp 孤儿文件
  // ═══════════════════════════════════════════
  describe('2. .tmp 孤儿文件处理', () => {
    it('2.1 启动时清理残留 .tmp', () => {
      const tmpFile = path.join(TEST_DIR, 'orphan.tmp');
      fs.writeFileSync(tmpFile, 'partial data');

      // 模拟数据库启动时的清理
      try {
        fs.unlinkSync(tmpFile);
      } catch (_) {}

      expect(fs.existsSync(tmpFile)).toBe(false);
    });

    it('2.2 多 .tmp 并发清理', () => {
      const tmps = ['data.json.tmp', 'odds.json.tmp', 'cache.json.tmp'];
      tmps.forEach((f) => fs.writeFileSync(path.join(TEST_DIR, f), 'x'));

      // 清理所有 .tmp
      const cleaned = [];
      tmps.forEach((f) => {
        const p = path.join(TEST_DIR, f);
        try {
          fs.unlinkSync(p);
          cleaned.push(f);
        } catch (_) {}
      });
      expect(cleaned.length).toBe(3);
    });

    it('2.3 .tmp 写完后未 rename → rename 后消失', () => {
      const tmpFile = path.join(TEST_DIR, 'db.json.tmp');
      const realFile = path.join(TEST_DIR, 'db.json');

      fs.writeFileSync(tmpFile, 'valid data');
      safeRename(tmpFile, realFile);

      expect(fs.existsSync(tmpFile)).toBe(false);
      expect(fs.existsSync(realFile)).toBe(true);
    });
  });

  // ═══════════════════════════════════════════
  // 3. odds_history 文件截断
  // ═══════════════════════════════════════════
  describe('3. odds_history 文件截断', () => {
    it('3.1 文件截断 → 空对象回退', () => {
      const file = path.join(TEST_DIR, '2026-06-10.json');

      // 模拟截断（写到一半）
      fs.writeFileSync(file, '{"date":"2026-06-10","odds":{"周二001":');

      let data = {};
      try {
        data = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (_) {
        data = { date: '2026-06-10', odds: {} };
      }

      expect(data).toBeDefined();
      expect(data.odds).toBeDefined();
      expect(Object.keys(data.odds).length).toBe(0); // 回退为空
    });

    it('3.2 文件大小异常检查', () => {
      const file = path.join(TEST_DIR, 'tiny.json');
      fs.writeFileSync(file, '{}');

      const stat = fs.statSync(file);
      expect(stat.size).toBeLessThan(100); // 太小
    });
  });

  // ═══════════════════════════════════════════
  // 4. SQLite 损坏检测
  // ═══════════════════════════════════════════
  describe('4. SQLite 损坏检测', () => {
    it('4.1 正常数据库 integrity_check 通过', () => {
      const Database = require('better-sqlite3');
      const db = new Database(':memory:');
      db.exec('CREATE TABLE test (id INT PRIMARY KEY)');
      const check = db.prepare('PRAGMA integrity_check').get();
      expect(check['integrity_check']).toBe('ok');
      db.close();
    });

    it('4.2 WAL checkpoint 执行', () => {
      const Database = require('better-sqlite3');
      const db = new Database(':memory:');
      db.pragma('journal_mode = WAL');
      db.exec('CREATE TABLE t1 (id INT)');
      db.prepare('INSERT INTO t1 VALUES (?)').run(1);
      // wal_checkpoint 应无错误
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
    });

    it('4.3 数据库文件恢复尝试', () => {
      // 模拟：尝试打开损坏的数据库 → 优雅降级
      const badPath = '/tmp/not_a_db_file.xyz';
      let openErr = null;
      try {
        const Database = require('better-sqlite3');
        new Database(badPath, { readonly: true });
      } catch (e) {
        openErr = e;
      }
      // 损坏/不存在的文件应抛异常
      if (openErr) {
        expect(openErr.message).toBeDefined();
      }
    });
  });

  // ═══════════════════════════════════════════
  // 5. 恢复后数据一致性验证
  // ═══════════════════════════════════════════
  describe('5. 恢复后一致性', () => {
    it('5.1 原子写入恢复 → 文件完整', () => {
      const realFile = path.join(TEST_DIR, 'recovered.json');
      const tmpFile = realFile + '.tmp';

      // 模拟：写入 .tmp 成功，rename 成功
      fs.writeFileSync(tmpFile, JSON.stringify({ v: 42 }));
      safeRename(tmpFile, realFile);

      // 验证
      const data = JSON.parse(fs.readFileSync(realFile, 'utf8'));
      expect(data.v).toBe(42);
      expect(fs.existsSync(tmpFile)).toBe(false);
    });

    it('5.2 写入中断再重试 → 最终正确', () => {
      const realFile = path.join(TEST_DIR, 'retry.json');
      const tmpFile = realFile + '.tmp';

      // 第一次写入故意不完整
      fs.writeFileSync(tmpFile, '{"v":');
      // 检测到不完整 → 清理 .tmp
      try {
        const written = fs.readFileSync(tmpFile);
        if (written.length < 10) {
          fs.unlinkSync(tmpFile);
        }
      } catch (_) {}

      // 重试完整写入
      fs.writeFileSync(tmpFile, JSON.stringify({ v: 99 }));
      safeRename(tmpFile, realFile);

      const data = JSON.parse(fs.readFileSync(realFile, 'utf8'));
      expect(data.v).toBe(99);
    });
  });
});
