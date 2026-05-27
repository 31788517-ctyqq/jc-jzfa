const fs = require('fs'), https = require('https'), path = require('path');

function get(u, p, h) {
    return new Promise((r, e) => {
        const q = p ? '?' + Object.keys(p).map(k => k + '=' + encodeURIComponent(p[k])).join('&') : '';
        const url = require('url').parse(u + q);
        const req = https.request({
            hostname: url.hostname, port: 443,
            path: url.pathname + (url.search || ''),
            headers: Object.assign({ 'Accept': '*/*', 'User-Agent': 'Mozilla/5.0' }, h || {}),
            rejectUnauthorized: false
        }, res => {
            let d = [];
            res.on('data', c => d.push(c));
            res.on('end', () => {
                try { r(JSON.parse(Buffer.concat(d).toString())); }
                catch (e) { r({ code: -1 }); }
            });
        });
        req.on('error', e => r({ code: -1 }));
        req.setTimeout(10000, () => { req.abort(); r({ code: -1 }); });
        req.end();
    });
}

let env = {};
try {
    fs.readFileSync(path.join('server', '.env'), 'utf-8')
        .split('\n').forEach(l => { const p = l.trim().split('='); if (p.length === 2) env[p[0]] = p[1]; });
} catch (x) { }

function cleanName(n) {
    return (n || '').replace(/\s/g, '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').toLowerCase();
}

async function main() {
    const r = await get('https://midou310.com/mdsj/gduser/login.do',
        { mobile: env.MIDOU_MOBILE, password: env.MIDOU_PASSWORD });
    if (r.code !== 1) { console.log('Login failed'); return; }
    const token = r.data.token;

    const testDates = ['2026-03-28', '2026-04-04', '2026-04-11', '2026-04-18'];

    for (const d of testDates) {
        const t = new Date(d + 'T00:00:00+08:00').getTime();
        const mr = await get('https://midou310.com/mdsj/score/footballDataList.do',
            { time: t, order: 'status desc, start_datetime asc, data_id asc' },
            { Cookie: 'token=' + token });

        if (!mr.data || mr.data.length === 0) {
            console.log(d + ': no midou data');
            continue;
        }

        // Sort midou by num
        const sorted = mr.data.filter(m => m.num).sort((a, b) => a.num.localeCompare(b.num));
        const db = JSON.parse(fs.readFileSync('server/odds_history/' + d + '.json', 'utf-8')).odds;

        console.log(`\n=== ${d}: midou=${sorted.length} DB=${Object.keys(db).length} ===`);

        let matches = 0, mismatches = 0, missing = 0;
        for (const mm of sorted) {
            const dbm = db[mm.num];
            if (dbm) {
                const dbHome = cleanName(dbm.homeName || ''), dbAway = cleanName(dbm.visitName || '');
                const mdHome = cleanName(mm.homeName || ''), mdAway = cleanName(mm.visitName || '');
                const homeOk = dbHome.includes(mdHome) || mdHome.includes(dbHome) || dbHome === mdHome;
                const awayOk = dbAway.includes(mdAway) || mdAway.includes(dbAway) || dbAway === mdAway;
                if (homeOk && awayOk) {
                    matches++;
                } else {
                    mismatches++;
                    console.log(`  ✗ ${mm.num}: midou=${mm.homeName}/${mm.visitName}  DB=${dbm.homeName}/${dbm.visitName}`);
                }
            } else {
                missing++;
                console.log(`  - ${mm.num}: ${mm.homeName}/${mm.visitName} [NOT IN DB]`);
            }
        }
        console.log(`  ✓match:${matches}  ✗mismatch:${mismatches}  -missing:${missing}`);
        
        // Check DB entries not in midou
        const midouNums = new Set(sorted.map(m => m.num));
        const dbExtras = Object.keys(db).filter(n => !midouNums.has(n));
        if (dbExtras.length > 0) {
            console.log(`  DB extras: ${dbExtras.length}`);
            dbExtras.slice(0, 3).forEach(n => console.log(`    ${n}: ${db[n].homeName}/${db[n].visitName}`));
        }

        await new Promise(rr => setTimeout(rr, 200));
    }
}

main().catch(e => console.error(e));
