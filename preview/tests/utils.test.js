/**
 * P2: utils.test.js — 前端工具函数 单元测试
 * 覆盖: formatDate、formatDateCN、getWeekDay、颜色常量、分类常量
 */
import {
  API, DIR_COLORS, CAT_NAMES, WEEK_NAMES, MIN_PLAN_DATE,
  getWeekDay, formatDate, formatDateCN
} from '../js/utils.js';

describe('utils — 常量', () => {
  it('API 指向 /api', () => {
    expect(API).toBe('/api');
  });

  it('DIR_COLORS 包含胜平负颜色', () => {
    expect(DIR_COLORS['胜']).toBe('#EF4444');
    expect(DIR_COLORS['平']).toBe('#FBBF24');
    expect(DIR_COLORS['负']).toBe('#60A5FA');
  });

  it('CAT_NAMES 包含6个分类', () => {
    expect(CAT_NAMES.length).toBe(6);
    expect(CAT_NAMES).toContain('综合排名');
    expect(CAT_NAMES).toContain('胜平负');
  });

  it('WEEK_NAMES 包含7天', () => {
    expect(WEEK_NAMES.length).toBe(7);
    expect(WEEK_NAMES[0]).toBe('周日');
    expect(WEEK_NAMES[6]).toBe('周六');
  });

  it('MIN_PLAN_DATE 是固定日期', () => {
    expect(MIN_PLAN_DATE).toBe('2026-03-19');
  });
});

describe('utils — formatDate', () => {
  it('格式化日期为 YYYY-MM-DD', () => {
    const result = formatDate(new Date('2026-06-15'));
    expect(result).toBe('2026-06-15');
  });

  it('月份和日期补零', () => {
    const result = formatDate(new Date('2026-01-05'));
    expect(result).toBe('2026-01-05');
  });

  it('年末日期正确', () => {
    const result = formatDate(new Date('2026-12-31'));
    expect(result).toBe('2026-12-31');
  });
});

describe('utils — formatDateCN', () => {
  it('格式化为 MM月DD日 周X', () => {
    // 2026-06-01 是周一
    const result = formatDateCN(new Date('2026-06-01'));
    expect(result).toContain('月');
    expect(result).toContain('日');
    expect(result).toMatch(/周[一-日]/);
  });

  it('返回值包含月份和日期', () => {
    const result = formatDateCN(new Date('2026-12-25'));
    expect(result).toContain('12月');
    expect(result).toContain('25日');
  });
});

describe('utils — getWeekDay', () => {
  it('周日返回 "周日"', () => {
    // 2026-06-07 是周日
    const result = getWeekDay('2026-06-07');
    expect(result).toBe('周日');
  });

  it('周一返回 "周一"', () => {
    const result = getWeekDay('2026-06-01');
    expect(result).toBe('周一');
  });

  it('周六返回 "周六"', () => {
    const result = getWeekDay('2026-06-06');
    expect(result).toBe('周六');
  });

  it('所有日期返回合法的星期名称', () => {
    const dates = ['2026-06-01', '2026-06-02', '2026-06-03',
      '2026-06-04', '2026-06-05', '2026-06-06', '2026-06-07'];
    dates.forEach(function (d) {
      const wd = getWeekDay(d);
      expect(WEEK_NAMES).toContain(wd);
    });
  });
});
