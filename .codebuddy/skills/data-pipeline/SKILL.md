---
name: data-pipeline
description: "数据管线与ETL自动化 - 统一抓取、清洗、加载流程，含数据质量门禁与监控告警"
version: "1.0.0"
---

# 数据管线 (Data Pipeline)

构建足彩数据抓取、清洗、存储的 ETL 工作流。

## 概述

本技能涵盖：
- 多源数据抓取（500.com、米斗、赔率接口）
- 数据清洗与标准化
- 存储加载
- 调度与监控
- 质量门禁与告警

---

## ETL 模式

### 基本流程

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   EXTRACT   │───▶│  TRANSFORM  │───▶│    LOAD     │
│             │    │             │    │             │
│ • 500.com   │    │ • 队伍名映射 │    │ • SQLite DB │
│ • 米斗API   │    │ • 赔率归一化 │    │ • data.json │
│ • 赔率爬虫  │    │ • 字段统一   │    │ • cache.json│
│ • 赛果抓取  │    │ • 数据校验   │    │ • 日志归档  │
└─────────────┘    └─────────────┘    └─────────────┘
```

### ETL 工作流配置

```yaml
workflow: "每日数据同步"
schedule: "每5分钟 / 赛前2小时起每2分钟"

nodes:
  # EXTRACT
  - name: "抓取500.com赛程"
    source: http
    url: "https://www.500.com/"
    parser: regex_html
    schedule: "every_5min"

  - name: "同步米斗指数"
    source: midou_api
    endpoint: "/api/odds/live"
    auth: api_key
    schedule: "every_2min_before_match"

  # TRANSFORM
  - name: "队伍名映射"
    type: lookup
    source: "scripts/remap_to_midou.js"
    mappings: team_aliases

  - name: "赔率标准化"
    type: normalize
    rules:
      - convert_hk_to_decimal
      - deduplicate_by_provider
      - validate_range: [1.01, 999.99]

  - name: "数据质量检查"
    type: quality_gate
    checks:
      - null_rate: < 5%
      - duplicate_rate: < 1%
      - expected_fields: [matchId, homeName, visitName, leagueName, date]

  # LOAD
  - name: "写入SQLite"
    type: database
    target: prediction_logs
    mode: upsert

  - name: "更新data.json"
    type: file
    target: server/data.json
    mode: atomic_write
```

---

## 数据源

### 现有抓取器

```yaml
extractors:
  http_scrapers:
    - fetch_odds.js:      # 500.com 赔率抓取
        url: "https://www.500.com/"
        method: puppeteer_render
        format: html_parse
    - fetch_shuju.js:     # 比赛数据抓取
        url: "https://live.500.com/"
        method: http_get
        format: json_parse
    - crawl_all.js:       # 全量爬虫
        schedule: daily_1am
    - backfill_*.js:      # 历史回填脚本
        trigger: manual

  midou_api:
    - endpoint: "/api/match/list"
      auth: api_key_header
      rate_limit: 60/min

  prediction:
    - deepseek.js:        # DeepSeek AI 分析
    - pk_scorer.js:       # PK 融合评分
    - plan-generator.js:  # 方案生成
```

---

## 数据转换

### 常见转换

```yaml
transformations:
  cleaning:
    - remove_nulls: drop_or_fill
    - trim_whitespace: all_string_fields
    - deduplicate: by_matchId_and_date

  mapping:
    - team_names: remap_to_midou.js
    - league_names: remap_v3.js
    - odds_format: HK → Decimal
    - direction_labels: {1: '主胜', 0: '平', -1: '客胜'}

  validation:
    - verify_completeness.js:   # 完整性校验
    - verify_remap.js:          # 映射校验

  enrichment:
    - gongshoudao: 功守道模型特征
    - pk_score: PK融合评分
    - ai_prediction: DeepSeek分析
```

---

## 调度与监控

### 调度配置

```yaml
scheduling:
  patterns:
    match_day:
      cron: "*/5 * * * *"           # 每5分钟数据刷新
      pre_match:
        cron: "*/2 * * * *"         # 赛前2小时高频刷新
        window: "2h_before_kickoff"
    off_day:
      cron: "0 */2 * * *"           # 非比赛日低频
    nightly:
      cron: "0 1 * * *"             # 每日凌晨数据清理
      tasks:
        - clean_expired_cache
        - compute_daily_stats
        - backup_database

  retries:
    max_attempts: 3
    delay: exponential_backoff
    alert_on: final_failure
```

### 监控指标

```yaml
monitoring:
  metrics:
    - rows_fetched       # 抓取记录数
    - rows_written       # 写入记录数
    - execution_time_ms  # 执行耗时
    - error_count        # 错误数
    - data_freshness     # 数据新鲜度（距上次更新时间）
    - success_rate       # 抓取成功率

  alerts:
    pipeline_failed:
      trigger: success_rate < 90%
      action: log_to_file + console_error

    data_quality:
      trigger: anomaly_detected
      conditions:
        - row_count: differs_by > 50%
        - null_rate: exceeds 15%
        - schema: changed_unexpectedly

    stale_data:
      trigger: last_update > 30min_before_kickoff
      action: force_refresh
```

---

## 数据质量门禁

### 质量检查项

```yaml
data_quality:
  schema_validation:
    required_fields: [matchId, homeName, visitName, leagueName, date]
    field_types:
      matchId: text_not_empty
      date: date_iso_format
      odds: number_range [1.01, 999.99]

  statistical_checks:
    null_rate: < 5%
    duplicate_rate: < 1%
    value_range:
      confidence: [0, 100]
      compositeScore: [0, 100]

  business_rules:
    - matchId_must_be_unique
    - match_date_not_in_future
    - home_team != away_team
    - odds_for_all_3_ways_present

  trend_analysis:
    - row_count: within_2_std_of_mean
    - new_matches_today: > 0 on match_days
```

---

## 输出示例

**请求**: "创建今日比赛数据管线"

**输出**:

```markdown
# 今日比赛数据管线

## 管线概览
500.com 赛程 → 米斗赔率 → DeepSeek AI → 功守道评分 → data.json

## 调度
- 常规刷新：每5分钟
- 赛前高频：每2分钟（开赛前2小时起）
- 重试：3次，指数退避

## 抓取
### 500.com 赛程
- URL: https://www.500.com/
- 方式: puppeteer 渲染 + HTML 解析
- 字段: [matchId, num, leagueName, homeName, visitName, date, startTime]

### 米斗赔率
- API: /api/odds/live
- 认证: API Key Header
- 频限: 60次/分钟

## 转换
- 队伍名映射（remap_to_midou.js）
- 联赛名标准化（remap_v3.js）
- 赔率格式统一（HK → Decimal）

## 加载
- data.json: 全量覆盖写入
- prediction_logs: UPSERT by matchId
- cache.json: 功守道缓存更新

## 质量检查
- [x] 行数 > 0
- [x] 无空 matchId
- [x] 赔率值在合法范围
- [x] 主客队名不重复

## 告警
- 日志: server/logs/
- 失败: 控制台输出 + 日志记录
```

---

*Data Pipeline Skill - JC-ZJFA 项目专用*
