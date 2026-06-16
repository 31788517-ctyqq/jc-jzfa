# ETL 规范详情

> 数据管线的 YAML 配置、调度策略、监控指标完整定义

## 工作流

```
EXTRACT                          TRANSFORM                     LOAD
500.com / 米斗 / sporttery  →  队名映射 / 赔率归一化 / 校验 →  SQLite + data.json + cache.json
```

## 抓取器清单

```yaml
extractors:
  http_scrapers:
    - fetch_odds.js      # 500.com 赔率 (puppeteer)
    - fetch_shuju.js     # 比赛数据 (http)
    - crawl_all.js       # 全量爬虫 (daily 1am)
  midou_api:
    endpoint: /api/match/list
    rate_limit: 60/min
  sporttery:
    rawDB 兜底赔率
```

## 转换规则

```yaml
transformations:
  cleaning: [remove_nulls, trim_whitespace, deduplicate by matchId+date]
  mapping: [team_names, league_names, odds_format HK→Decimal]
  validation: [verify_completeness, verify_remap]
  enrichment: [gongshoudao, pk_score, ai_prediction]
```

## 调度

```yaml
scheduling:
  match_day:     "*/5 * * * *"      # 每5分钟
  pre_match:     "*/2 * * * *"      # 赛前2小时高频
  off_day:       "0 */2 * * *"      # 非比赛日
  nightly:       "0 1 * * *"       # 每日凌晨: 清理缓存 + 统计 + 备份
  retries: 3次, 指数退避, 最终失败告警
```

## 监控指标

- rows_fetched / rows_written / execution_time_ms
- error_count / data_freshness / success_rate
- 告警: success_rate < 90% / null_rate > 15% / row_count 偏差 > 50%
