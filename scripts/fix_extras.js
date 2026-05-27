/** 修复 V3 中 _unmatched 条目的星期前缀 */
const fs = require('fs'), path = require('path');

const ODDS_DIR = path.join(__dirname, '..', 'server', 'odds_history');

function getDay(dateStr) {
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return days[new Date(dateStr + 'T00:00:00+08:00').getDay()];
}

const files = fs.readdirSync(ODDS_DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
let fixed = 0;

for (const file of files) {
    const dateStr = file.replace('.json', '');
    if (dateStr > '2026-04-24') continue;
    
    const filePath = path.join(ODDS_DIR, file);
    const dbData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const odds = dbData.odds || {};
    const dayOfWeek = getDay(dateStr);
    
    let modified = false;
    const newOdds = {};
    
    for (const [oldNum, entry] of Object.entries(odds)) {
        if (entry._unmatched || (entry.num || '').startsWith('*')) {
            // Fix the number
            const n = parseInt(oldNum.slice(-3));
            const newNum = dayOfWeek + String(n).padStart(3, '0');
            entry.num = newNum;
            entry._unmatched = true;
            newOdds[newNum] = entry;
            modified = true;
        } else {
            newOdds[oldNum] = entry;
        }
    }
    
    if (modified) {
        dbData.odds = newOdds;
        fs.writeFileSync(filePath, JSON.stringify(dbData, null, 2), 'utf-8');
        fixed++;
        console.log(`  ${dateStr}: fixed extras`);
    }
}

console.log(`\nFixed ${fixed} files`);
