/**
 * 将 odds_history 中 sporttery 编号统一为 midou310/500.com 编号体系
 */
const fs = require('fs'), https = require('https'), path = require('path');

const ODDS_DIR = path.join(__dirname, '..', 'server', 'odds_history');
const DATE_START = '2026-03-19', DATE_END = '2026-04-24';

// Load env
let env = {};
try {
    fs.readFileSync(path.join(__dirname, '..', 'server', '.env'), 'utf-8')
        .split('\n').forEach(l => { const p = l.trim().split('='); if (p.length === 2) env[p[0]] = p[1]; });
} catch (x) { }

function get(url, params, headers) {
    return new Promise((resolve, reject) => {
        const q = params ? '?' + Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&') : '';
        const u = require('url').parse(url + q);
        const req = https.request({
            hostname: u.hostname, port: 443,
            path: u.pathname + (u.search || ''),
            headers: Object.assign({ 'Accept': '*/*', 'User-Agent': 'Mozilla/5.0' }, headers || {}),
            rejectUnauthorized: false
        }, res => {
            let data = [];
            res.on('data', d => data.push(d));
            res.on('end', () => {
                try { resolve(JSON.parse(Buffer.concat(data).toString())); }
                catch (e) { resolve({ code: -1, msg: String(e).slice(0, 200) }); }
            });
        });
        req.on('error', e => resolve({ code: -1, msg: e.message }));
        req.setTimeout(15000, () => { req.abort(); resolve({ code: -1, msg: 'timeout' }); });
        req.end();
    });
}

function cleanName(name) {
    if (!name) return '';
    return name.replace(/\s/g, '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').toLowerCase();
}

function matchTeams(n1, n2) {
    const a = cleanName(n1), b = cleanName(n2);
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.includes(b) || b.includes(a)) return true;
    let common = 0;
    for (const c of a) { if (b.includes(c)) common++; }
    return common >= Math.max(a.length, b.length) * 0.6;
}

async function main() {
    // Login to midou310
    console.log('Logging into midou310...');
    const loginRes = await get('https://midou310.com/mdsj/gduser/login.do', {
        mobile: env.MIDOU_MOBILE, password: env.MIDOU_PASSWORD
    });
    if (loginRes.code !== 1) {
        console.log('Login failed:', loginRes.msg);
        return;
    }
    const token = loginRes.data.token;
    console.log('Login OK\n');

    // Build date list
    const dates = [];
    let cur = new Date(DATE_START + 'T00:00:00+08:00');
    const end = new Date(DATE_END + 'T00:00:00+08:00');
    while (cur <= end) {
        const ds = cur.toISOString().slice(0, 10);
        const dbPath = path.join(ODDS_DIR, ds + '.json');
        if (fs.existsSync(dbPath)) dates.push(ds);
        cur.setDate(cur.getDate() + 1);
    }
    console.log(`Found ${dates.length} date files to remap\n`);

    let totalRemapped = 0, totalUnchanged = 0, totalNotFound = 0, totalSkipped = 0;

    for (const dateStr of dates) {
        // Query midou310 match list
        const timestamp = new Date(dateStr + 'T00:00:00+08:00').getTime();
        const mr = await get('https://midou310.com/mdsj/score/footballDataList.do',
            { time: timestamp, order: 'status desc, start_datetime asc, data_id asc' },
            { Cookie: 'token=' + token });

        if (!mr.data || mr.data.length === 0) {
            console.log(`  ${dateStr}: no midou310 data, skipping`);
            totalSkipped++;
            continue;
        }

        const midouMatches = mr.data.filter(m => m.num).map(m => ({
            num: m.num, homeName: m.homeName || '', visitName: m.visitName || ''
        }));

        if (midouMatches.length === 0) {
            console.log(`  ${dateStr}: 0 matches with num, skipping`);
            totalSkipped++;
            continue;
        }

        // Load DB
        const dbPath = path.join(ODDS_DIR, dateStr + '.json');
        const dbData = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
        const odds = dbData.odds || {};

        // Remap
        const newOdds = {};
        let remapped = 0, unchanged = 0, notfound = 0;

        for (const [oldNum, entry] of Object.entries(odds)) {
            const dbHome = entry.homeName || '';
            const dbAway = entry.visitName || '';

            // Find matching midou entry
            let found = null;
            for (const mm of midouMatches) {
                if (matchTeams(dbHome, mm.homeName) && matchTeams(dbAway, mm.visitName)) {
                    found = mm;
                    break;
                }
            }

            if (found) {
                const newNum = found.num;
                if (newNum !== oldNum) {
                    entry.num = newNum;
                    entry._old_num = oldNum;  // preserve old number
                    remapped++;
                } else {
                    unchanged++;
                }
                newOdds[newNum] = entry;
                // Remove from midouMatches so we know which midou entries weren't used
                const idx = midouMatches.indexOf(found);
                if (idx >= 0) midouMatches.splice(idx, 1);
            } else {
                notfound++;
                newOdds[oldNum] = entry;
            }
        }

        // Report unmatched midou entries
        let extra = '';
        if (midouMatches.length > 0) {
            extra = ` | ${midouMatches.length} unmatched midou: ${midouMatches.map(m => m.num + ':' + m.homeName + '/' + m.visitName).join(', ')}`;
        }

        // Save
        dbData.odds = newOdds;
        fs.writeFileSync(dbPath, JSON.stringify(dbData, null, 2), 'utf-8');

        console.log(`  ${dateStr}: midou${mr.data.length} | DB${Object.keys(odds).length} | remap:${remapped} unchange:${unchanged} nf:${notfound}${extra}`);

        totalRemapped += remapped;
        totalUnchanged += unchanged;
        totalNotFound += notfound;

        // Rate limit
        await new Promise(r => setTimeout(r, 200));
    }

    console.log(`\n=== Remap Complete ===`);
    console.log(`Total remapped: ${totalRemapped} | unchanged: ${totalUnchanged} | not found: ${totalNotFound} | skipped: ${totalSkipped}`);
}

main().catch(e => console.error(e));
