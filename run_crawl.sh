#!/bin/bash
# 运行全量爬虫并部署数据
cd /var/www/zj.100qiu.com/server

echo "=== 开始全量爬取 $(date) ==="
node crawl_all.js > /tmp/crawl_log.txt 2>&1
echo "=== 爬取完成 $(date) ==="

# 检查输出文件
if [ -f data_all.json ]; then
  SIZE=$(du -sh data_all.json | cut -f1)
  echo "data_all.json 已生成 ($SIZE)"
  
  # 替换现有 data.json
  cp data.json data_bak.json 2>/dev/null
  cp data_all.json data.json
  echo "data.json 已替换"
  
  # 重启服务
  pm2 restart jc-zjfa
  echo "服务已重启"
else
  echo "ERROR: data_all.json 未生成"
  cat /tmp/crawl_log.txt | tail -10
fi
