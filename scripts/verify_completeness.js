/**
 * 全量验证 3/19 - 5/25 赔率数据完整性
 * 检查: SPF 胜平负、RQSPF 让球胜平负、JQS 进球数
 */
const fs = require('fs'), path = require('path');

const ODDS_DIR = path.join(__dirname, '..', 'server', 'odds_history');
const DATE_START = '2026-03-19', DATE_END = '2026-05-25';

const files = fs.readdirSync(ODDS_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .filter(f => {
        const d = f.replace('.json', '');
        return d >= DATE_START && d <= DATE_END;
    })
    .sort();

console.log(`=== 赔率完整性验证: ${DATE_START} ~ ${DATE_END} ===`);
console.log(`日期文件数: ${files.length}\n`);

let totals = { days: 0, matches: 0, spf: 0, spfMiss: 0, rqspf: 0, rqspfMiss: 0, jqs: 0, jqsMiss: 0 };
let issues = [];

for (const file of files) {
    const dateStr = file.replace('.json', '');
    const data = JSON.parse(fs.readFileSync(path.join(ODDS_DIR, file), 'utf-8'));
    const odds = data.odds || {};
    
    totals.days++;
    const dayMatches = Object.keys(odds).length;
    totals.matches += dayMatches;
    
    let daySPF = 0, daySPFMiss = 0, dayRQSPF = 0, dayRQSPFMiss = 0, dayJQS = 0, dayJQSMiss = 0;
    
    for (const [num, m] of Object.entries(odds)) {
        // SPF 检查
        if (m.spf && m.spf.home > 0) {
            daySPF++;
            totals.spf++;
        } else {
            daySPFMiss++;
            totals.spfMiss++;
        }
        
        // RQSPF 检查
        if (m.rqspf && m.rqspf.home > 0) {
            dayRQSPF++;
            totals.rqspf++;
        } else {
            dayRQSPFMiss++;
            totals.rqspfMiss++;
        }
        
        // JQS 检查
        if (m.totalGoals && Object.keys(m.totalGoals).length > 0) {
            const vals = Object.values(m.totalGoals);
            if (vals.some(v => v !== null && v > 0)) {
                dayJQS++;
                totals.jqs++;
            } else {
                dayJQSMiss++;
                totals.jqsMiss++;
            }
        } else {
            dayJQSMiss++;
            totals.jqsMiss++;
        }
    }
    
    // 只输出有缺失的日期
    const hasIssues = daySPFMiss > 0 || dayRQSPFMiss > 0 || dayJQSMiss > 0;
    if (hasIssues) {
        console.log(`${dateStr}: ${dayMatches}场 | SPF缺${daySPFMiss} RQ缺${dayRQSPFMiss} JQS缺${dayJQSMiss}`);
        issues.push({ date: dateStr, matches: dayMatches, spfMiss: daySPFMiss, rqMiss: dayRQSPFMiss, jqsMiss: dayJQSMiss });
    }
}

console.log(`\n=== 汇总 ===`);
console.log(`日期: ${totals.days} 天 | 总比赛: ${totals.matches} 场`);
console.log(`SPF (胜平负):     ${totals.spf}/${totals.matches} 有效 (${(totals.spf/totals.matches*100).toFixed(1)}%)，缺失 ${totals.spfMiss} 场`);
console.log(`RQSPF (让球胜平负): ${totals.rqspf}/${totals.matches} 有效 (${(totals.rqspf/totals.matches*100).toFixed(1)}%)，缺失 ${totals.rqspfMiss} 场`);
console.log(`JQS (进球数):      ${totals.jqs}/${totals.matches} 有效 (${(totals.jqs/totals.matches*100).toFixed(1)}%)，缺失 ${totals.jqsMiss} 场`);
console.log(`\n问题日期: ${issues.length} 天`);

// 按缺失严重程度排序
issues.sort((a, b) => (b.spfMiss + b.rqMiss + b.jqsMiss) - (a.spfMiss + a.rqMiss + a.jqsMiss));
if (issues.length > 0) {
    console.log('\n缺失最多的日期:');
    issues.slice(0, 10).forEach(i => {
        console.log(`  ${i.date}: ${i.matches}场 | SPF缺${i.spfMiss} RQ缺${i.rqMiss} JQS缺${i.jqsMiss}`);
    });
}

// 检查日期连续性
console.log('\n=== 日期连续性 ===');
let expectedDates = [];
let cur = new Date(DATE_START + 'T00:00:00+08:00');
const end = new Date(DATE_END + 'T00:00:00+08:00');
while (cur <= end) {
    expectedDates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
}
const fileDates = new Set(files.map(f => f.replace('.json', '')));
const missingDates = expectedDates.filter(d => !fileDates.has(d));
const emptyDates = files.filter(f => {
    const d = JSON.parse(fs.readFileSync(path.join(ODDS_DIR, f), 'utf-8'));
    return Object.keys(d.odds || {}).length === 0;
}).map(f => f.replace('.json', ''));

if (missingDates.length > 0) console.log('缺失日期文件:', missingDates.join(', '));
if (emptyDates.length > 0) console.log('空日期文件 (0场):', emptyDates.join(', '));
if (missingDates.length === 0 && emptyDates.length === 0) console.log('✓ 日期连续，无空缺');
