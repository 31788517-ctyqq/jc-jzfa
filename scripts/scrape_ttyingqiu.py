#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ttyingqiu.com 专家计划抓取工具 (Playwright 优化版)

主要功能:
  - 从移动端抓取专家列表 (tab=3)
  - 抓取专家历史计划详情 (包含对阵、方向、赔率)
  - 支持增量抓取和断点续传
"""

import asyncio
import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional

from playwright.async_api import async_playwright

# ─── 配置 ────────────────────────────────────────────
BASE_URL = "https://m.ttyingqiu.com"
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "server"
EXPERTS_PATH = OUTPUT_DIR / "ttyingqiu_experts_jh.json"
PLANS_PATH = OUTPUT_DIR / "ttyingqiu_plans_jh.json"
CHECKPOINT_PATH = OUTPUT_DIR / "ttyingqiu_jh_checkpoint.json"

CONFIG = {
    "viewport": {"width": 375, "height": 812},
    "scroll_delay": 1.2,
    "max_scrolls": 150,
    "concurrent_experts": 2,
    "test_limit": 3,
    "test_plans_per_expert": 5,
}

# ─── 数据结构转换 ──────────────────────────────────────

def clean_plan_item(raw_plan: Dict[str, Any], expert_id: str, expert_name: str) -> Dict[str, Any]:
    """清洗单条计划数据"""
    matches = []
    phases = raw_plan.get("phaseList") or raw_plan.get("itemVos") or []
    
    for ph in phases:
        # 尝试从 itemVos (嵌套结构) 提取更丰富的比赛信息
        items = ph.get("itemVos") or []
        if items:
            for it in items:
                # 寻找选择的项 (selected: True)
                pick_name = None
                for play in it.get("playList", []):
                    for val in play.get("valueList", []):
                        if val.get("selected"):
                            pick_name = val.get("raceValueDesc")
                
                matches.append({
                    "match_id": str(it.get("id")),
                    "match_time": datetime.fromtimestamp(it["matchTime"] / 1000).isoformat() if it.get("matchTime") else None,
                    "odds": it.get("prize") or ph.get("minPrize"),
                    "status": it.get("raceStatusStr") or it.get("statusStr"),
                    "win_status": it.get("winStatus"),
                    "home_team": it.get("homeTeam") or it.get("hostTeam"),
                    "away_team": it.get("guestTeam") or it.get("awayTeam"),
                    "pick": pick_name or ph.get("pickName"),
                    "match_name": it.get("matchName") or it.get("raceName")
                })
        else:
            # 回退到基础结构
            matches.append({
                "match_id": str(ph.get("matchId") or ph.get("id")),
                "match_time": datetime.fromtimestamp(ph["matchTime"] / 1000).isoformat() if ph.get("matchTime") else None,
                "odds": ph.get("minPrize") or ph.get("sp"),
                "status": ph.get("raceStatusStr") or ph.get("winStatusStr"),
                "win_status": ph.get("winStatus"),
                "home_team": ph.get("homeTeam"),
                "away_team": ph.get("guestTeam"),
                "pick": ph.get("pickName"),
                "match_name": ph.get("matchName")
            })

    return {
        "plan_id": raw_plan.get("id"),
        "expert_id": expert_id,
        "expert_name": expert_name,
        "create_time": datetime.fromtimestamp(raw_plan["createTime"] / 1000).isoformat() if raw_plan.get("createTime") else None,
        "stage": raw_plan.get("phase"),
        "plan_no": raw_plan.get("periodNo"),
        "status_code": raw_plan.get("status"),
        "matches": matches
    }

# ─── 核心抓取类 ────────────────────────────────────────

class TTYJHScraper:
    def __init__(self, headless: bool = True):
        self.headless = headless
        self.experts = []
        self.checkpoint = {}

    def load_local_data(self):
        if EXPERTS_PATH.exists():
            with open(EXPERTS_PATH, "r", encoding="utf-8") as f:
                self.experts = json.load(f).get("experts", [])
        if CHECKPOINT_PATH.exists():
            with open(CHECKPOINT_PATH, "r", encoding="utf-8") as f:
                self.checkpoint = json.load(f)

    def save_checkpoint(self):
        with open(CHECKPOINT_PATH, "w", encoding="utf-8") as f:
            json.dump(self.checkpoint, f, ensure_ascii=False, indent=2)

    async def discover_experts(self):
        """阶段1: 发现专家列表"""
        print("══════ 阶段1: 发现专家列表 ══════")
        async with async_playwright() as p:
            device = p.devices["iPhone 12"]
            browser = await p.chromium.launch(headless=self.headless)
            context = await browser.new_context(**device)
            page = await context.new_page()

            url = f"{BASE_URL}/#/tabs/expert;tab=3"
            print(f"访问 {url}...")
            await page.goto(url, wait_until="load", timeout=60000)
            await asyncio.sleep(5)
            
            # 尝试滚动以加载更多专家
            for _ in range(5):
                await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                await asyncio.sleep(1.5)

            items = await page.query_selector_all(".exConList_li")
            print(f"  找到 {len(items)} 个专家项，正在解析...")
            
            experts = []
            seen = set()
            for item in items:
                try:
                    name_el = await item.query_selector(".name")
                    name = await name_el.inner_text() if name_el else "未知"
                    
                    await item.click()
                    await asyncio.sleep(1.5)
                    curr_url = page.url
                    match = re.search(r"id=(\d+)", curr_url)
                    if match:
                        eid = match.group(1)
                        if eid not in seen:
                            experts.append({"id": eid, "name": name})
                            seen.add(eid)
                            print(f"    [+] {name} ({eid})")
                    await page.go_back()
                    await asyncio.sleep(1)
                except Exception as e:
                    print(f"    [!] 解析专家失败: {e}")

            print(f"共发现 {len(experts)} 位专家")
            with open(EXPERTS_PATH, "w", encoding="utf-8") as f:
                json.dump({"generated_at": datetime.now().isoformat(), "experts": experts}, f, ensure_ascii=False, indent=2)
            self.experts = experts
            await browser.close()

    async def scrape_expert_plans(self, expert: Dict[str, Any], semaphore: asyncio.Semaphore, test_mode: bool = False):
        """阶段2: 抓取专家历史计划及详情"""
        async with semaphore:
            eid, name = expert["id"], expert["name"]
            if self.checkpoint.get(eid) == "done":
                print(f"  [跳过] {name}({eid})")
                return

            print(f"  [开始] {name}({eid})")
            async with async_playwright() as p:
                device = p.devices["iPhone 12"]
                browser = await p.chromium.launch(headless=self.headless)
                context = await browser.new_context(**device)
                page = await context.new_page()
                
                captured_plans = []

                async def handle_list_response(response):
                    if "/api/expert/jh/list" in response.url:
                        try:
                            data = await response.json()
                            items = data.get("list", []) or data.get("data", {}).get("list", [])
                            if items:
                                existing_ids = {str(p["plan_id"]) for p in captured_plans}
                                for raw_p in items:
                                    pid = str(raw_p.get("id"))
                                    if pid not in existing_ids:
                                        captured_plans.append(clean_plan_item(raw_p, eid, name))
                        except: pass

                page.on("response", handle_list_response)
                await page.goto(f"{BASE_URL}/#/plan-order/home;id={eid};gameType=2")
                await asyncio.sleep(5)

                # 1. 深度滚动加载全量历史
                print(f"    {name}: 正在加载全量历史方案...")
                last_count = 0
                no_change_count = 0
                for s in range(CONFIG["max_scrolls"]):
                    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                    await asyncio.sleep(CONFIG["scroll_delay"])
                    
                    load_more = await page.query_selector("text=加载更多")
                    if load_more:
                        await load_more.click()
                        await asyncio.sleep(2)

                    curr_count = len(captured_plans)
                    if curr_count == last_count:
                        no_change_count += 1
                        if no_change_count >= 6: break
                    else:
                        no_change_count = 0
                    
                    last_count = curr_count
                    if not test_mode:
                        print(f"\r    {name}: 已发现 {curr_count} 条计划 (滚动 {s+1})", end="", flush=True)
                    else:
                        if curr_count >= CONFIG["test_plans_per_expert"]: break

                # 2. 获取详情 (补全对阵信息及 Pick)
                print(f"\n    {name}: 正在补全 {len(captured_plans)} 条计划的详情...")
                
                plans_to_process = captured_plans
                if test_mode:
                    plans_to_process = captured_plans[:CONFIG["test_plans_per_expert"]]
                
                for i, p in enumerate(plans_to_process):
                    dpid = str(p["plan_id"])
                    try:
                        detail_url = f"{BASE_URL}/#/plan-order/detail;id={dpid}"
                        captured_detail = None
                        
                        async def intercept_detail(response):
                            nonlocal captured_detail
                            if "/api/expert/jh/detail" in response.url and response.status == 200:
                                try:
                                    res_data = await response.json()
                                    if res_data and "data" in res_data:
                                        captured_detail = res_data["data"]
                                except: pass

                        page.on("response", intercept_detail)
                        try:
                            await page.goto(detail_url, wait_until="commit", timeout=10000)
                            for _ in range(10):
                                if captured_detail: break
                                await asyncio.sleep(0.5)
                        except: pass
                        page.remove_listener("response", intercept_detail)
                        
                        if captured_detail:
                            d = captured_detail
                            d_phases = d.get("phaseList") or d.get("itemVos") or []
                            for dp in d_phases:
                                d_items = dp.get("itemVos") or [dp]
                                for di in d_items:
                                    mid = str(di.get("id") or di.get("matchId"))
                                    for m in p["matches"]:
                                        if str(m.get("match_id")) == mid or m.get("home_team") is None:
                                            m.update({
                                                "home_team": di.get("homeTeam") or di.get("hostTeam") or m.get("home_team"),
                                                "away_team": di.get("guestTeam") or di.get("awayTeam") or m.get("away_team"),
                                                "match_name": di.get("matchName") or di.get("raceName") or m.get("match_name"),
                                                "pick": di.get("pickName") or m.get("pick")
                                            })
                                            for play in di.get("playList", []):
                                                for val in play.get("valueList", []):
                                                    if val.get("selected"):
                                                        m["pick"] = val.get("raceValueDesc")
                            
                            # --- 增强逻辑：如果通过 JSON 没拿到 pick，尝试从 DOM 提取 ---
                            if not any(m.get("pick") for m in p["matches"]):
                                picks_from_dom = await page.evaluate("""() => {
                                    const spans = Array.from(document.querySelectorAll('.point span.red, .point span.wrong'));
                                    return spans.map(s => s.innerText.split('(')[0].trim());
                                }""")
                                if picks_from_dom:
                                    for m in p["matches"]:
                                        if not m.get("pick"):
                                            m["pick"] = picks_from_dom[0]
                                            
                            print(f"      [+] 详情补全: {dpid} ({i+1}/{len(plans_to_process)})")
                        else:
                            print(f"      [?] 未捕获到详情 API: {dpid}")
                        
                    except Exception as e:
                        print(f"      [!] Detail Error for {dpid}: {e}")
                
                expert_file = OUTPUT_DIR / f"tty_plans_{eid}.json"
                with open(expert_file, "w", encoding="utf-8") as f:
                    json.dump(plans_to_process, f, ensure_ascii=False, indent=2)
                
                self.checkpoint[eid] = "done"
                self.save_checkpoint()
                print(f"    {name}: 完成，共 {len(plans_to_process)} 条记录已持久化")
                await browser.close()

    async def run(self, test_mode: bool = False):
        start_time = time.time()
        self.load_local_data()
        if not self.experts: await self.discover_experts()
        
        targets = self.experts[:CONFIG["test_limit"]] if test_mode else self.experts
        print(f"\n══════ 阶段2: 抓取详情 (并发: {CONFIG['concurrent_experts']}) ══════")
        
        sem = asyncio.Semaphore(CONFIG["concurrent_experts"])
        await asyncio.gather(*[self.scrape_expert_plans(e, sem, test_mode=test_mode) for e in targets])
        
        all_plans = []
        for e in targets:
            f = OUTPUT_DIR / f"tty_plans_{e['id']}.json"
            if f.exists():
                with open(f, "r", encoding="utf-8") as file: all_plans.extend(json.load(file))
        
        with open(PLANS_PATH, "w", encoding="utf-8") as f:
            json.dump({"generated_at": datetime.now().isoformat(), "total": len(all_plans), "plans": all_plans}, f, ensure_ascii=False, indent=2)
            
        print(f"\n[OK] 抓取完成，共 {len(all_plans)} 条方案 -> {PLANS_PATH}")
        print(f"总耗时: {(time.time() - start_time) / 60:.1f} 分钟")

async def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--test", action="store_true")
    parser.add_argument("--headless", action="store_false", default=True)
    args = parser.parse_args()
    scraper = TTYJHScraper(headless=args.headless)
    await scraper.run(test_mode=args.test)

if __name__ == "__main__":
    if sys.platform == "win32": asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    asyncio.run(main())
