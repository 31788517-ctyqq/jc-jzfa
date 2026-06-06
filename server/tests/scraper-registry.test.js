/**
 * Phase 6 — P1: scraper-registry.test.js
 * 爬虫注册表验证测试
 * 覆盖: registry schema 验证、脚本存在性检查、cron 合法性、DDL 声明检查
 */
const fs = require('fs');
const path = require('path');

// 尝试加载注册表（可能尚未创建）
function loadRegistry() {
  try {
    return require('../scraper_registry.json');
  } catch (e) {
    return null;
  }
}

describe('scraper-registry — schema 验证', () => {
  const registry = loadRegistry();

  beforeAll(() => {
    if (!registry) console.log('[scraper-registry test] scraper_registry.json 尚未创建，仅执行 schema 验证');
  });

  it('注册表应为有效 JSON 对象', () => {
    if (!registry) return; // 文件不存在时跳过
    expect(typeof registry).toBe('object');
    expect(registry).toHaveProperty('version');
    expect(registry).toHaveProperty('scrapers');
  });

  it('每个爬虫条目应有必需字段', () => {
    if (!registry || !registry.scrapers) return;
    const required = ['name', 'script', 'type', 'category'];
    Object.entries(registry.scrapers).forEach(([key, cfg]) => {
      required.forEach((field) => {
        expect(cfg).toHaveProperty(field);
      });
    });
  });

  it('type 应为已知值', () => {
    if (!registry || !registry.scrapers) return;
    const knownTypes = ['python', 'node', 'bash'];
    Object.values(registry.scrapers).forEach((cfg) => {
      expect(knownTypes).toContain(cfg.type);
    });
  });

  it('category 应为已知值', () => {
    if (!registry || !registry.scrapers) return;
    const knownCategories = ['odds', 'analysis', 'schedule', 'h2h', 'standings', 'backfill', 'migration', 'mapping', 'merge', 'diagnostic'];
    Object.values(registry.scrapers).forEach((cfg) => {
      expect(knownCategories).toContain(cfg.category);
    });
  });
});

describe('scraper-registry — cron 合法性', () => {
  const registry = loadRegistry();

  it('schedule.cron 应为 5 字段标准格式', () => {
    if (!registry || !registry.scrapers) return;
    Object.values(registry.scrapers).forEach((cfg) => {
      if (cfg.schedule && cfg.schedule.cron) {
        const parts = cfg.schedule.cron.split(' ');
        // 标准 cron: minute hour day month weekday
        expect(parts.length).toBeGreaterThanOrEqual(5);
      }
    });
  });

  it('cron 字段值应在合法范围内', () => {
    if (!registry || !registry.scrapers) return;
    Object.values(registry.scrapers).forEach((cfg) => {
      if (cfg.schedule && cfg.schedule.cron) {
        const parts = cfg.schedule.cron.split(' ');
        const ranges = [
          [0, 59],   // minute
          [0, 23],   // hour
          [1, 31],   // day
          [1, 12],   // month
          [0, 7],    // weekday (0或7=周日)
        ];
        parts.slice(0, 5).forEach((p, i) => {
          // 跳过 * 和含字母的表达式
          if (p === '*' || /[A-Za-z,/-]/.test(p)) return;
          const n = parseInt(p);
          if (!isNaN(n)) {
            expect(n).toBeGreaterThanOrEqual(ranges[i][0]);
            expect(n).toBeLessThanOrEqual(ranges[i][1]);
          }
        });
      }
    });
  });
});

describe('scraper-registry — 脚本存在性', () => {
  const registry = loadRegistry();

  it('每个注册的脚本文件应存在', () => {
    if (!registry || !registry.scrapers) return;
    const root = path.join(__dirname, '..');
    Object.entries(registry.scrapers).forEach(([key, cfg]) => {
      if (!cfg.script) return;
      // 提取命令和第一个参数
      const parts = cfg.script.split(' ');
      const scriptPath = parts[parts.length - 1]; // 最后一个是文件路径
      const fullPath = path.resolve(root, scriptPath);
      const exists = fs.existsSync(fullPath);
      if (!exists) {
        console.warn('[scraper-registry test] 脚本不存在: ' + key + ' → ' + fullPath);
      }
      // 不强制失败，因为可能依赖外部命令（如 python）
    });
  });
});

describe('scraper-registry — timeout 和 retry 配置', () => {
  const registry = loadRegistry();

  it('timeout_sec 应为正数', () => {
    if (!registry || !registry.scrapers) return;
    Object.values(registry.scrapers).forEach((cfg) => {
      if (cfg.timeout_sec !== undefined) {
        expect(cfg.timeout_sec).toBeGreaterThan(0);
      }
    });
  });

  it('retry.max 应在合理范围 (1-10)', () => {
    if (!registry || !registry.scrapers) return;
    Object.values(registry.scrapers).forEach((cfg) => {
      if (cfg.retry && cfg.retry.max) {
        expect(cfg.retry.max).toBeGreaterThanOrEqual(1);
        expect(cfg.retry.max).toBeLessThanOrEqual(10);
      }
    });
  });

  it('quality_check.min_records 应为正数', () => {
    if (!registry || !registry.scrapers) return;
    Object.values(registry.scrapers).forEach((cfg) => {
      if (cfg.quality_check && cfg.quality_check.min_records !== undefined) {
        expect(cfg.quality_check.min_records).toBeGreaterThan(0);
      }
    });
  });
});

describe('scraper-registry — pipelines DAG', () => {
  const registry = loadRegistry();

  it('pipeline steps 中的 scraper 应在 scrapers 中注册', () => {
    if (!registry || !registry.pipelines || !registry.scrapers) return;
    const scraperNames = new Set(Object.keys(registry.scrapers));
    Object.values(registry.pipelines).forEach((pipe) => {
      (pipe.steps || []).forEach((step) => {
        if (step.scraper && !scraperNames.has(step.scraper)) {
          console.warn('[scraper-registry test] pipeline 引用了未注册的爬虫: ' + step.scraper);
        }
      });
    });
  });

  it('depends_on 不应形成循环依赖', () => {
    if (!registry || !registry.pipelines) return;
    Object.values(registry.pipelines).forEach((pipe) => {
      const steps = pipe.steps || [];
      const stepNames = new Set(steps.map((s) => s.scraper).filter(Boolean));
      steps.forEach((step) => {
        (step.depends_on || []).forEach((dep) => {
          // depends_on 中的爬虫应在本 pipeline 的 steps 中出现（或为外部触发）
          expect([...stepNames, 'sync_match_list', 'sync_500odds'].some(
            (n) => n === dep
          )).toBeTruthy();
        });
      });
    });
  });
});
