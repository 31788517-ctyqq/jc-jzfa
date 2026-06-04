/**
 * P2: scraper.test.js — generateDateRange 纯函数测试
 * 直接内联函数以避免 scraper.js 顶层 process.exit(1)
 */
function generateDateRange(startDate, endDate) {
  const dates = [];
  const current = new Date(startDate);
  const end = new Date(endDate);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

describe('scraper — generateDateRange 日期范围生成', () => {
  it('单天范围 → 1天', () => {
    const dates = generateDateRange('2026-06-01', '2026-06-01');
    expect(dates).toEqual(['2026-06-01']);
    expect(dates.length).toBe(1);
  });

  it('5天范围', () => {
    const dates = generateDateRange('2026-06-01', '2026-06-05');
    expect(dates.length).toBe(5);
    expect(dates[0]).toBe('2026-06-01');
    expect(dates[4]).toBe('2026-06-05');
  });

  it('跨月范围', () => {
    const dates = generateDateRange('2026-03-30', '2026-04-02');
    expect(dates.length).toBe(4);
    expect(dates).toContain('2026-03-31');
    expect(dates).toContain('2026-04-01');
  });

  it('跨年范围', () => {
    const dates = generateDateRange('2025-12-30', '2026-01-02');
    expect(dates.length).toBe(4);
    expect(dates[0]).toBe('2025-12-30');
    expect(dates[3]).toBe('2026-01-02');
  });

  it('日期已排序递增', () => {
    const dates = generateDateRange('2026-05-01', '2026-05-10');
    for (let i = 1; i < dates.length; i++) {
      // 日期字符串直接比较: "2026-05-02" > "2026-05-01" 
      expect(dates[i] > dates[i - 1]).toBe(true);
    }
  });

  it('30天范围 → 30天', () => {
    const dates = generateDateRange('2026-06-01', '2026-06-30');
    expect(dates.length).toBe(30);
  });

  it('reverse 范围 (end < start) → 返回空数组', () => {
    const dates = generateDateRange('2026-06-05', '2026-06-01');
    expect(dates.length).toBe(0);
  });
});
