const { crawlDate } = require('./scraper');
const db = require('./database');
db.initDatabase();

(async () => {
  for (let d = 19; d <= 31; d++) {
    const dateStr = '2026-03-' + String(d).padStart(2, '0');
    console.log('[' + dateStr + ']');
    try {
      const r = await crawlDate(dateStr);
      console.log('  ->', r.status, r.matchCount + '场', r.recommCount + '条');
    } catch (e) {
      console.error('  -> error:', e.message);
    }
  }
  db.closeDatabase();
  console.log('done');
})();
