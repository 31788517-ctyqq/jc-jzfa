/**
 * V3: 完整重映射 - 优先使用midou310编号体系
 * 1. midou310有、sporttery有 → 使用midou310编号
 * 2. midou310有、sporttery无 → 标记为缺失
 * 3. midou310无、sporttery有 → 分配从maxNum+1开始的后续编号
 * 4. 使用matchId精确匹配（3/19-3/25用备份SQLite，3/26+用API）
 */
const fs = require('fs'), https = require('https'), path = require('path');
const Database = require('better-sqlite3');

const ODDS_DIR = path.join(__dirname, '..', 'server', 'odds_history');
const SPORTTERY_FILE = path.join(__dirname, '..', 'server', 'ttyingqiu_data', 'sporttery_bqc_bf_jqs.json');
const DATE_START = '2026-03-19', DATE_END = '2026-04-24';

// 加载 sporttery 数据
const sportteryRaw = JSON.parse(fs.readFileSync(SPORTTERY_FILE, 'utf-8'));
const sportteryByDate = {};
for (const [mid, m] of Object.entries(sportteryRaw)) {
    const dt = m.date || '';
    if (!dt) continue;
    if (!sportteryByDate[dt]) sportteryByDate[dt] = { matchId: mid, ...m };
}

// 加载备份SQLite
const backupDB = new Database('_backup_20260525/midou_data.db');
const backupRows = backupDB.prepare(
    'SELECT matchId, num, homeName, visitName, date FROM matches WHERE date >= ? AND date <= ?'
).all('2026-03-19', '2026-03-25');
backupDB.close();

const backupByIdDate = {};
for (const row of backupRows) {
    const key = row.date + '|' + String(row.matchId);
    backupByIdDate[key] = { num: row.num, homeName: row.homeName, visitName: row.visitName };
}
console.log(`Backup SQLite: ${backupRows.length} rows`);

let env = {};
try { fs.readFileSync(path.join(__dirname, '..', 'server', '.env'), 'utf-8').split('\n').forEach(l => { const p = l.trim().split('='); if (p.length === 2) env[p[0]] = p[1]; }); } catch (x) { }

function get(u, p, h) {
    return new Promise((resolve) => {
        const q = p ? '?' + Object.keys(p).map(k => k + '=' + encodeURIComponent(p[k])).join('&') : '';
        const url = require('url').parse(u + q);
        const req = https.request({
            hostname: url.hostname, port: 443, path: url.pathname + (url.search || ''),
            headers: Object.assign({ 'Accept': '*/*', 'User-Agent': 'Mozilla/5.0' }, h || {}),
            rejectUnauthorized: false
        }, res => {
            let d = []; res.on('data', c => d.push(c));
            res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(d).toString())); } catch (e) { resolve({ code: -1 }); } });
        });
        req.on('error', e => resolve({ code: -1 }));
        req.setTimeout(15000, () => { req.abort(); resolve({ code: -1 }); });
        req.end();
    });
}

function cleanName(n) { return (n || '').replace(/\s/g, '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').toLowerCase(); }

async function fetchMidouAPI(token, dateStr) {
    const t = new Date(dateStr + 'T00:00:00+08:00').getTime();
    const mr = await get('https://midou310.com/mdsj/score/footballDataList.do',
        { time: t, order: 'status desc, start_datetime asc, data_id asc' },
        { Cookie: 'token=' + token });
    if (!mr.data) return [];
    return mr.data.filter(m => m.num).map(m => ({
        matchId: String(m.matchId || ''), num: m.num, homeName: m.homeName || '', visitName: m.visitName || ''
    }));
}

async function main() {
    const loginRes = await get('https://midou310.com/mdsj/gduser/login.do', {
        mobile: env.MIDOU_MOBILE, password: env.MIDOU_PASSWORD
    });
    if (loginRes.code !== 1) { console.log('Login failed'); return; }
    const token = loginRes.data.token;
    console.log('Login OK\n');

    const dates = [];
    let cur = new Date(DATE_START + 'T00:00:00+08:00');
    const end = new Date(DATE_END + 'T00:00:00+08:00');
    while (cur <= end) {
        const ds = cur.toISOString().slice(0, 10);
        if (fs.existsSync(path.join(ODDS_DIR, ds + '.json'))) dates.push(ds);
        cur.setDate(cur.getDate() + 1);
    }

    for (const dateStr of dates) {
        const dbPath = path.join(ODDS_DIR, dateStr + '.json');
        const dbData = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
        const odds = dbData.odds || {};
        
        // 获取midou310比赛列表
        let midouMatches = [];
        if (dateStr <= '2026-03-25') {
            // 从备份SQLite
            for (const [key, v] of Object.entries(backupByIdDate)) {
                if (key.startsWith(dateStr + '|')) {
                    midouMatches.push({ matchId: key.split('|')[1], num: v.num, homeName: v.homeName, visitName: v.visitName });
                }
            }
        } else {
            midouMatches = await fetchMidouAPI(token, dateStr);
            await new Promise(r => setTimeout(r, 150));
        }

        if (midouMatches.length === 0) {
            console.log(`  ${dateStr}: 0 midou, skip`);
            continue;
        }

        // 排序midou编号（按num排序获取编号顺序）
        midouMatches.sort((a, b) => a.num.localeCompare(b.num));

        // 计算最大midou编号
        let maxNum = 0;
        for (const mm of midouMatches) {
            const n = parseInt(mm.num.slice(-3));
            if (n > maxNum) maxNum = n;
        }

        // Build: matchId -> midou entry
        const midouByMatchId = {};
        for (const mm of midouMatches) {
            if (mm.matchId) midouByMatchId[mm.matchId] = mm;
        }

        // 构建新odds
        const newOdds = {};
        let matched = 0, unmatched = 0;
        const dbUsed = new Set(); // track which DB entries were matched

        // 按midou编号顺序分配
        for (const mm of midouMatches) {
            // Find DB entry by matchId
            let found = null;
            for (const [oldNum, entry] of Object.entries(odds)) {
                if (dbUsed.has(oldNum)) continue;
                if (entry.matchId && entry.matchId === mm.matchId) {
                    found = entry;
                    break;
                }
            }
            
            // If not found by matchId, try exact name match
            if (!found) {
                for (const [oldNum, entry] of Object.entries(odds)) {
                    if (dbUsed.has(oldNum)) continue;
                    if (cleanName(entry.homeName || '') === cleanName(mm.homeName || '') &&
                        cleanName(entry.visitName || '') === cleanName(mm.visitName || '')) {
                        found = entry;
                        break;
                    }
                }
            }

            if (found) {
                // Use midou310's number
                found.num = mm.num;
                if (found.num !== mm.num) {
                    // 这个entry之前可能被分到不同编号
                    const oldKeys = Object.keys(odds).filter(k => odds[k] === found && k !== mm.num);
                    // Remove from old positions will be handled by new structure
                }
                newOdds[mm.num] = found;
                // Find the oldNum key for this entry and mark as used
                for (const [oldNum, entry] of Object.entries(odds)) {
                    if (entry === found && oldNum !== mm.num) {
                        dbUsed.add(oldNum);
                        break;
                    }
                }
                matched++;
            }
            // else: midou310 entry not in DB → skip (it's a data gap)
        }

        // Add unmatched DB entries with new numbers
        const dayOfWeek = dateStr.slice(8) === '19' ? '周四' : (odds[maxNum] || {num:'*'}).num.slice(0, 2) || getDay(dateStr);
        let nextNum = maxNum + 1;
        for (const [oldNum, entry] of Object.entries(odds)) {
            if (dbUsed.has(oldNum)) continue;
            // Check if already added
            if (Object.values(newOdds).some(v => v === entry)) continue;
            let newNum = `${dayOfWeek}${String(nextNum).padStart(3, '0')}`;
            while (newOdds[newNum]) {
                nextNum++;
                newNum = `${dayOfWeek}${String(nextNum).padStart(3, '0')}`;
            }
            entry.num = newNum;
            entry._unmatched = true; // mark as unmatched
            newOdds[newNum] = entry;
            nextNum++;
            unmatched++;
        }

        dbData.odds = newOdds;
        fs.writeFileSync(dbPath, JSON.stringify(dbData, null, 2), 'utf-8');

        console.log(`  ${dateStr}: midou=${midouMatches.length} matched=${matched} unmatched=${unmatched} max=${maxNum}`);
    }

    console.log(`\nDone!`);
}

function getDay(dateStr) {
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return days[new Date(dateStr + 'T00:00:00+08:00').getDay()];
}

main().catch(e => console.error(e));
