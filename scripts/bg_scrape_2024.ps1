# 后台启动 2024 年竞彩数据抓取
# 用法: .\scripts\bg_scrape_2024.ps1

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir

$LogDir = Join-Path $ProjectRoot "logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$LogFile = Join-Path $LogDir "scrape_2024_$Timestamp.log"
$Phase = $args[0]

Write-Host "╔══════════════════════════════════════╗"
Write-Host "║  2024 竞彩数据后台抓取              ║"
Write-Host "╚══════════════════════════════════════╝"
Write-Host ""
Write-Host "日志文件: $LogFile"
Write-Host ""

# ═══════════════════════════════════════
# Phase 1: 补抓空缺日期 (2024-06-10 ~ 2024-12-31)
# ═══════════════════════════════════════
function Start-Phase1 {
    Write-Host "[Phase 1] 抓取 2024-06-10 ~ 2024-12-31 (空缺217天)"
    Write-Host "  预计耗时: 2~6小时 (取决于比赛密度和网络)"

    $job = Start-Job -Name "Scrape2024_Gap" -ScriptBlock {
        param($root, $log)
        Set-Location $root
        
        # Redirect all output to log file
        & python scripts/scrape_sporttery.py --start 2024-06-10 --end 2024-12-31 *>&1 | Out-File $log -Append -Encoding utf8
        
        # Auto bridge after scrape
        "`n=== 自动桥接到SQLite ===" | Out-File $log -Append -Encoding utf8
        node scripts/bridge_sporttery_to_odds.js 2>&1 | Out-File $log -Append -Encoding utf8
        
        "`n=== 回填比分 ===" | Out-File $log -Append -Encoding utf8
        node server/backfill_scores_from_json.js 2>&1 | Out-File $log -Append -Encoding utf8
        
        "`n=== Phase 1 完成 ===" | Out-File $log -Append -Encoding utf8
    } -ArgumentList $ProjectRoot, $LogFile

    Write-Host "  任务ID: $($job.Id)"
    Write-Host "  监控: Get-Content '$LogFile' -Wait"
    return $job
}

# ═══════════════════════════════════════
# Phase 2: 缺漏补全 (已覆盖日期中缺失的场次)
# ═══════════════════════════════════════
function Start-Phase2 {
    Write-Host "[Phase 2] 补全已覆盖日期中的缺失场次"
    Write-Host "  重新扫描2024-01-01~2024-06-09，只抓JSON中缺失的比赛"

    $job = Start-Job -Name "Scrape2024_Fill" -ScriptBlock {
        param($root, $log)
        Set-Location $root
        
        # 先分析缺口
        "`n=== 分析缺口 ===" | Out-File $log -Append -Encoding utf8
        node -e "
        var fs=require('fs'),path=require('path');
        var dir='server/sporttery_odds';
        var files=fs.readdirSync(dir).filter(f=>f.endsWith('.json'));
        var jsonMids=new Set();
        var dateMids={};
        files.forEach(f=>{
          try{
            var d=JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));
            var m=d.matchInfo||'';
            var dt=(m.match(/(\d{4}-\d{2}-\d{2})/)||[])[1]||'';
            if(dt>='2024-01-01'&&dt<='2024-06-09'){
              jsonMids.add(f.replace('.json',''));
              dateMids[dt]=(dateMids[dt]||[]);
              dateMids[dt].push(f.replace('.json',''));
            }
          }catch(e){}
        });
        var db=require('better-sqlite3')('server/midou_data.db',{readonly:true});
        var all2024=db.prepare(\"SELECT matchId,date FROM matches WHERE date>='2024-01-01' AND date<='2024-06-09'\").all();
        var missing=[];
        all2024.forEach(m=>{
          if(!jsonMids.has(m.matchId)){
            missing.push(m);
          }
        });
        console.log('JSON文件中有: '+jsonMids.size+' 个matchId');
        console.log('matches表中有: '+all2024.length+' 场');
        console.log('缺少JSON的比赛: '+missing.length+' 场');
        if(missing.length>0){
          console.log('前20场:');
          missing.slice(0,20).forEach(m=>console.log('  '+m.date+' '+m.matchId));
        }
        // 保存缺失列表
        if(missing.length>0){
          fs.writeFileSync('server/missing_2024h1.json',JSON.stringify(missing));
        }
        db.close();
        " 2>&1 | Out-File $log -Append -Encoding utf8

        "`n=== Phase 2 完成 ===" | Out-File $log -Append -Encoding utf8
    } -ArgumentList $ProjectRoot, $LogFile

    Write-Host "  任务ID: $($job.Id)"
    return $job
}

# ═══════════════════════════════════════
# Phase 2b: 缺失场次补抓（直接调用API）
# ═══════════════════════════════════════
function Start-Phase2b {
    Write-Host "[Phase 2b] 逐场补抓缺失比赛（使用Playwright直接定位）"

    $job = Start-Job -Name "Scrape2024_Missing" -ScriptBlock {
        param($root, $log)
        Set-Location $root
        
        # 读取缺失列表并逐一补抓
        "`n=== Phase 2b: 逐场补抓 ===" | Out-File $log -Append -Encoding utf8
        node -e "
        var fs=require('fs'),path=require('path');
        var missingFile='server/missing_2024h1.json';
        if(!fs.existsSync(missingFile)){
          console.log('无缺失文件');
          process.exit(0);
        }
        var missing=JSON.parse(fs.readFileSync(missingFile,'utf8'));
        console.log('需要补抓: '+missing.length+' 场');
        
        // 按日期分组
        var byDate={};
        missing.forEach(function(m){
          var d=(m.date||'').substring(0,10);
          byDate[d]=(byDate[d]||[]);
          byDate[d].push(m.matchId);
        });
        console.log('涉及日期: '+Object.keys(byDate).length+' 天');
        
        // 生成curl命令供手动执行（playwright太重）
        Object.keys(byDate).sort().forEach(function(d){
          console.log('python scripts/scrape_sporttery.py --date '+d);
        });
        " 2>&1 | Out-File $log -Append -Encoding utf8

        "`n=== Phase 2b 完成 ===" | Out-File $log -Append -Encoding utf8
    } -ArgumentList $ProjectRoot, $LogFile

    Write-Host "  任务ID: $($job.Id)"
    return $job
}

# ═══════════════════════════════════════
# Main
# ═══════════════════════════════════════
switch ($Phase) {
    "1" {
        $j1 = Start-Phase1
        Write-Host "`n监控命令:"
        Write-Host "  Get-Content '$LogFile' -Tail 20 -Wait"
        Write-Host "`n查看任务状态:"
        Write-Host "  Get-Job"
        Write-Host "`n等待完成:"
        Write-Host "  Wait-Job -Id $($j1.Id) | Receive-Job"
    }
    "2" {
        $j2 = Start-Phase2
        Write-Host "`nPhase 2 启动，先分析缺口..."
        Write-Host "  Get-Job -Id $($j2.Id) | Receive-Job -Wait"
    }
    default {
        # 全部启动
        Write-Host "启动 Phase 1 (空缺日期) + Phase 2 (缺口分析)..."
        $j1 = Start-Phase1
        Start-Sleep -Seconds 2
        $j2 = Start-Phase2
        
        Write-Host ""
        Write-Host "═══════════════════════════════════════"
        Write-Host "  后台任务已启动"
        Write-Host "═══════════════════════════════════════"
        Write-Host ""
        Write-Host "  实时监控:"
        Write-Host "    Get-Content '$LogFile' -Tail 30 -Wait"
        Write-Host ""
        Write-Host "  任务状态:"
        Write-Host "    Get-Job"
        Write-Host ""
        Write-Host "  查看Phase1输出:"
        Write-Host "    Get-Job -Name Scrape2024_Gap | Receive-Job -Keep"
        Write-Host ""
        Write-Host "  等待全部完成:"
        Write-Host "    Get-Job | Wait-Job"
        Write-Host ""
        Write-Host "  停止任务:"
        Write-Host "    Get-Job | Stop-Job"
        Write-Host "    Get-Job | Remove-Job"
    }
}
