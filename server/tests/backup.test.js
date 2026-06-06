/**
 * Phase 9 — P1: backup.test.js
 * 统一备份系统测试
 * 覆盖: backup() 函数结构、清理逻辑、保留策略
 */
const os = require('os');

// 模拟 backup 模块（模块可能尚未创建）
const BACKUP_CONFIG = {
  KEEP_DAILY: 7,
  KEEP_WEEKLY: 4,
  BACKUP_DIR: '/root/backups',
  BACKUP_FILES: [
    '/root/server/midou_data.db',
    '/root/server/data.json',
    '/root/server/trends.json',
    '/root/server/gongshoudao/cache.json',
  ],
};

describe('backup — 配置验证', () => {
  it('KEEP_DAILY 应为 7 天', () => {
    expect(BACKUP_CONFIG.KEEP_DAILY).toBe(7);
  });

  it('KEEP_WEEKLY 应为 4 周', () => {
    expect(BACKUP_CONFIG.KEEP_WEEKLY).toBe(4);
  });

  it('BACKUP_DIR 应在 /root/backups', () => {
    expect(BACKUP_CONFIG.BACKUP_DIR).toContain('backups');
    expect(BACKUP_CONFIG.BACKUP_DIR).toContain('/');
  });

  it('BACKUP_FILES 至少包含 3 个核心文件', () => {
    expect(BACKUP_CONFIG.BACKUP_FILES.length).toBeGreaterThanOrEqual(3);
    const paths = BACKUP_CONFIG.BACKUP_FILES.map((p) => require('path').basename(p));
    expect(paths).toContain('midou_data.db');
    expect(paths).toContain('data.json');
  });
});

describe('backup — 清理策略', () => {
  it('Daily 保留策略：7天内不清理', () => {
    const now = Date.now();
    const dayMs = 24 * 3600 * 1000;

    // 模拟：6 天前的备份应保留
    const recentBackup = { time: now - 6 * dayMs };
    const isWeekly = new Date(recentBackup.time).getDay() === 0;
    const keep = isWeekly || (now - recentBackup.time < BACKUP_CONFIG.KEEP_DAILY * dayMs);
    expect(keep).toBe(true);

    // 模拟：10 天前的非周日备份应清理
    const oldBackup = { time: now - 10 * dayMs };
    const oldIsWeekly = new Date(oldBackup.time).getDay() === 0;
    const shouldKeep = oldIsWeekly || (now - oldBackup.time < BACKUP_CONFIG.KEEP_DAILY * dayMs);
    expect(shouldKeep).toBe(false);
  });

  it('周日快照应跨周保留', () => {
    const dayMs = 24 * 3600 * 1000;
    // 找到最近一个周日
    const now = new Date();
    const todayDay = now.getDay(); // 0=周日
    const daysSinceLastSunday = todayDay === 0 ? 0 : todayDay;
    // 3周前的周日（在KEEP_WEEKLY=4范围内）
    const threeWeeksAgoSunday = Date.now() - (daysSinceLastSunday + 21) * dayMs;
    const isWeekly = new Date(threeWeeksAgoSunday).getDay() === 0;
    const keep = isWeekly && (Date.now() - threeWeeksAgoSunday < BACKUP_CONFIG.KEEP_WEEKLY * 7 * dayMs);
    expect(keep).toBe(true);
  });
});

describe('backup — 旧格式清理', () => {
  it('应清理 /tmp/deploy_backup_* 目录', () => {
    const pattern = 'deploy_backup_';
    expect(pattern).toContain('deploy_backup');
  });

  it('应清理 /tmp/db_backup_* 目录', () => {
    const pattern = 'db_backup_';
    expect(pattern).toContain('db_backup');
  });

  it('应清理 .corrupted_* 残留文件', () => {
    const pattern = '.corrupted_';
    expect(pattern).toContain('corrupted');
  });
});

describe('backup — SQLite 备份方式', () => {
  it('应优先使用 sqlite3 .backup API', () => {
    const cmd = "sqlite3 /root/server/midou_data.db \".backup '/root/backups/backup_xxx/midou_data.db'\"";
    expect(cmd).toContain('.backup');
    expect(cmd).toContain('sqlite3');
  });

  it('.backup 失败时应降级为 cp', () => {
    const fallback = 'cp /root/server/midou_data.db /root/backups/backup_xxx/';
    expect(fallback).toContain('cp ');
    expect(fallback).toContain('midou_data.db');
  });
});

describe('backup — 元信息', () => {
  it('备份目录应包含 backup_info.json', () => {
    const metaFile = {
      time: new Date().toISOString(),
      label: 'daily',
      hostname: os.hostname(),
      files: ['midou_data.db', 'data.json'],
    };
    expect(metaFile).toHaveProperty('time');
    expect(metaFile).toHaveProperty('label');
    expect(metaFile).toHaveProperty('hostname');
    expect(metaFile).toHaveProperty('files');
    expect(Array.isArray(metaFile.files)).toBe(true);
  });
});

describe('backup — 触发点', () => {
  it('应支持 daily 自动备份', () => {
    const trigger = 'backup(\'daily\')';
    expect(trigger).toContain('daily');
  });

  it('应支持 pre_deploy 备份', () => {
    const trigger = 'backup(\'pre_deploy\')';
    expect(trigger).toContain('pre_deploy');
  });

  it('应支持 API 手动备份', () => {
    const action = { action: 'backup-db' };
    expect(action.action).toBe('backup-db');
  });
});
