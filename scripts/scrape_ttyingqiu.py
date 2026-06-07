#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ttyingqiu.com 专家推荐数据抓取工具 (Python async 版)

相比 Node.js 原版的改进:
  - httpx AsyncClient 连接池复用 (HTTP/2 keep-alive)
  - asyncio 并发抓取 (5 专家并行, 阶段3 10 并发详情)
  - 指数退避重试 (3 次)
  - checkpoint 断点续传 (阶段2/3 崩溃可恢复)
  - 速度: 数小时 → 15~30 分钟

用法:
  python scripts/scrape_ttyingqiu.py discover    # 发现专家
  python scripts/scrape_ttyingqiu.py scrape      # 抓取解读列表
  python scripts/scrape_ttyingqiu.py detail      # 抓取解读详情
  python scripts/scrape_ttyingqiu.py all         # 全流程
"""

import asyncio
import json
import os
import re
import sys
import time
import random
import argparse
from pathlib import Path
from datetime import datetime
from typing import Optional

import httpx

# ─── 配置 ────────────────────────────────────────────
HOST = "www.ttyingqiu.com"
BASE_URL = f"https://{HOST}"
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "server"

CONFIG = {
    "since": "2026-01-01",
    "search_index": 100,
    "race_type_football": 1,
    "delay_min": 0.3,      # 最小延迟(秒), Python版可更激进
    "delay_max": 0.8,
    "max_pages": 100,
    "max_retries": 3,
    "retry_base": 1.5,     # 指数退避基数
    "concurrent_experts": 5,       # 阶段2 并发抓取专家数
    "concurrent_details": 10,      # 阶段3 并发抓取详情数
    "concurrent_probes": 30,       # 阶段1 并发探测数
    "expert_id_range_start": 200000,
    "expert_id_range_end": 300000,
    "probe_step": 1,
    "discover_target": 300,
    "request_timeout": 20.0,
    "builtin_experts": [
        {"id": "212520", "name": "杨子墨", "raceType": 1},
    ],
}

# ─── 全局会话 ────────────────────────────────────────
_client: Optional[httpx.AsyncClient] = None
_cookies: dict = {}
_checkpoint: dict = {}   # {expert_id: last_page}
_checkpoint_path: Path = OUTPUT_DIR / "ttyingqiu_checkpoint.json"


async def get_client() -> httpx.AsyncClient:
    """获取或创建共享的 httpx AsyncClient (连接池复用)"""
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            base_url=BASE_URL,
            timeout=CONFIG["request_timeout"],
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept-Language": "zh-CN,zh;q=0.9",
            },
            http2=True,
            follow_redirects=True,
            limits=httpx.Limits(
                max_keepalive_connections=20,
                max_connections=50,
                keepalive_expiry=30,
            ),
        )
    return _client


# ─── 工具函数 ────────────────────────────────────────

async def init_session() -> None:
    """初始化会话 Cookie"""
    global _cookies
    try:
        client = await get_client()
        resp = await client.get("/")
        _cookies = dict(resp.cookies)
        print(f"  会话 Cookie: {'OK' if _cookies else '无'}")
    except Exception:
        print("  会话 Cookie: 无 (连接失败, 继续尝试)")


def save_json(data, filepath: Path) -> None:
    """原子写入 JSON (先写临时文件再重命名)"""
    tmp = filepath.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp.replace(filepath)


def load_json(filepath: Path, default=None):
    """安全读取 JSON"""
    if not filepath.exists():
        return default if default is not None else {}
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)


def load_checkpoint() -> dict:
    """加载断点续传进度"""
    return load_json(_checkpoint_path, {})


def save_checkpoint(data: dict) -> None:
    """保存断点续传进度"""
    save_json(data, _checkpoint_path)


def parse_odds(sp_string: str) -> Optional[dict]:
    """SP 格式: '11200-62500-130000;...' → {win, draw, lose}"""
    if not sp_string:
        return None
    parts = sp_string.split(";")[0]
    odds = parts.split("-")
    if len(odds) >= 3:
        return {
            "win": float(odds[0]) / 10000,
            "draw": float(odds[1]) / 10000,
            "lose": float(odds[2]) / 10000,
        }
    return None


def parse_interpretation(raw: dict, expert_id: str) -> dict:
    """解析单条解读的 JSON 响应"""
    interp = raw.get("tjInterpretationSimple") or {}
    races = raw.get("raceList") or []
    member = raw.get("jcobMember") or {}

    matches = []
    for r in races:
        matches.append({
            "match_name": r.get("matchName", ""),
            "match_no": r.get("matchNo", ""),
            "home_team": r.get("homeTeam") or r.get("homeTeamShortName", ""),
            "away_team": r.get("guestTeam") or r.get("guestTeamShortName", ""),
            "match_time": datetime.fromtimestamp(r["matchTime"] / 1000).isoformat() if r.get("matchTime") else "",
            "status": r.get("statusStr", ""),
            "status_code": r.get("status", 0),
            "odds": parse_odds(r.get("sp", "")),
            "handicap": r.get("handicap", ""),
            "sp_raw": r.get("sp", ""),
            "match_id": r.get("fxId", ""),
        })

    return {
        "interpretation_id": interp.get("id"),
        "expert_id": str(expert_id),
        "expert_name": member.get("nickName", ""),
        "create_time": datetime.fromtimestamp(interp["createTime"] / 1000).isoformat() if interp.get("createTime") else "",
        "game_desc": interp.get("gameDesc", ""),
        "improv_status": interp.get("improvStatus", 0),
        "features": interp.get("features", ""),
        "race_count": raw.get("raceCount", len(matches)),
        "matches": matches,
    }


# ─── HTTP 请求封装 ────────────────────────────────────

async def http_get(path: str, referer: str = "", retries: int = None) -> str:
    """GET 请求 + 指数退避重试"""
    if retries is None:
        retries = CONFIG["max_retries"]
    client = await get_client()
    headers = {}
    if referer:
        headers["Referer"] = referer
    if _cookies:
        headers["Cookie"] = "; ".join(f"{k}={v}" for k, v in _cookies.items())

    last_err = None
    for attempt in range(retries + 1):
        try:
            resp = await client.get(path, headers=headers)
            if resp.status_code == 406:
                raise Exception("API_406")
            resp.raise_for_status()
            return resp.text
        except Exception as e:
            last_err = e
            if attempt < retries:
                wait = CONFIG["retry_base"] ** attempt + random.uniform(0, 0.5)
                await asyncio.sleep(wait)
    raise last_err


async def http_post(path: str, body: str, referer: str = "", retries: int = None) -> str:
    """POST 请求 + 指数退避重试"""
    if retries is None:
        retries = CONFIG["max_retries"]
    client = await get_client()
    headers = {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Accept": "*/*",
        "X-Requested-With": "XMLHttpRequest",
    }
    if referer:
        headers["Referer"] = referer
    if _cookies:
        headers["Cookie"] = "; ".join(f"{k}={v}" for k, v in _cookies.items())

    last_err = None
    for attempt in range(retries + 1):
        try:
            resp = await client.post(path, content=body, headers=headers)
            if resp.status_code == 406:
                raise Exception("API_406")
            resp.raise_for_status()
            return resp.text
        except Exception as e:
            last_err = e
            if attempt < retries:
                wait = CONFIG["retry_base"] ** attempt + random.uniform(0, 0.5)
                await asyncio.sleep(wait)
    raise last_err


# ═══════════════════════════════════════════════════════
#  阶段1: 发现专家
# ═══════════════════════════════════════════════════════

async def probe_expert(expert_id: int, race_type: int, sem: asyncio.Semaphore) -> Optional[dict]:
    """探测单个专家 ID 是否有数据"""
    async with sem:
        body = f"exportId={expert_id}&searchIndex={CONFIG['search_index']}&raceTypeId={race_type}"
        try:
            raw = await http_post("/expert/home/interpretation2/1", body)
            data = json.loads(raw)
            page = data.get("page", {})
            data_list = page.get("dataList", [])
            if data_list:
                name = data_list[0].get("jcobMember", {}).get("nickName", "")
                return {
                    "id": str(expert_id),
                    "name": name,
                    "totalPages": page.get("totalPages", 1),
                }
        except Exception:
            pass
    return None


async def discover_experts() -> list:
    """阶段1: 并发探测专家 ID 范围"""
    print("══════ 阶段1: 发现专家 ══════\n")
    step = CONFIG["probe_step"]
    concurrent = CONFIG["concurrent_probes"]
    target = CONFIG["discover_target"]
    start, end = CONFIG["expert_id_range_start"], CONFIG["expert_id_range_end"]

    ids = list(range(start, end + 1, step))
    print(f"探测范围: {start}~{end}, 步长: {step}, 并发: {concurrent}")
    print(f"目标: {target} 位专家, 共 {len(ids)} 个探测点\n")

    sem = asyncio.Semaphore(concurrent)
    out_path = OUTPUT_DIR / "ttyingqiu_experts.json"
    experts = []
    found_count = 0

    # 分批并发探测
    batch_size = 200
    for i in range(0, len(ids), batch_size):
        batch = ids[i : i + batch_size]
        tasks = [probe_expert(eid, CONFIG["race_type_football"], sem) for eid in batch]
        results = await asyncio.gather(*tasks)

        for r in results:
            if r:
                experts.append(r)
                found_count += 1
                print(f"  [+] #{found_count} ID {r['id']}: {r['name']} ({r['totalPages']}页)")

        # 增量保存
        save_json({
            "generated_at": datetime.now().isoformat(),
            "total": len(experts),
            "experts": experts,
        }, out_path)

        if len(experts) >= target:
            print(f"\n[OK] 已达到目标 {target} 位专家！")
            break

        remaining = min(i + batch_size, len(ids))
        print(f"  进度: {remaining}/{len(ids)}, 已发现 {len(experts)}/{target}")

    print(f"\n发现 {len(experts)} 位活跃专家 → {out_path}\n")
    return experts


# ═══════════════════════════════════════════════════════
#  阶段2: 抓取解读列表 (并发 + 断点续传)
# ═══════════════════════════════════════════════════════

async def fetch_interpretation_page(expert_id: str, race_type: int, page_no: int) -> Optional[dict]:
    """抓取单页解读列表"""
    body = f"exportId={expert_id}&searchIndex={CONFIG['search_index']}&raceTypeId={race_type}"
    path = f"/expert/home/interpretation2/{page_no}"
    referer = f"{BASE_URL}/expert/home/{expert_id}"
    raw = await http_post(path, body, referer)
    data = json.loads(raw)
    return data.get("page")


async def scrape_expert(expert: dict, index: int, total: int, checkpoint: dict, sem: asyncio.Semaphore) -> Optional[dict]:
    """抓取单个专家的全部解读 (支持断点续传)"""
    async with sem:
        eid = expert["id"]
        name = expert.get("name", "")
        rt = expert.get("raceType", CONFIG["race_type_football"])
        prefix = f"  [{index}/{total}] {name}({eid})"

        all_interpretations = []
        resume_page = checkpoint.get(eid, 1)
        page_no = resume_page

        try:
            # 先获取第一页以确定总页数
            page = await fetch_interpretation_page(eid, rt, page_no)
            if not page or not page.get("dataList"):
                return None

            total_pages = min(page.get("totalPages", 1), CONFIG["max_pages"])

            while page_no <= total_pages:
                if page_no > resume_page:
                    # 翻页延迟
                    await asyncio.sleep(random.uniform(CONFIG["delay_min"], CONFIG["delay_max"]))
                    page = await fetch_interpretation_page(eid, rt, page_no)
                    if not page or not page.get("dataList"):
                        break

                data_list = page.get("dataList", [])
                for item in data_list:
                    all_interpretations.append(parse_interpretation(item, eid))

                # 更新断点
                checkpoint[eid] = page_no
                if page_no % 5 == 0:
                    save_checkpoint(checkpoint)

                print(f"\r{prefix}: 第{page_no}/{total_pages}页, {len(all_interpretations)}条", end="", flush=True)

                if page_no >= total_pages:
                    break
                page_no += 1

            print()  # 换行

            completed = sum(1 for i in all_interpretations
                          if any(m.get("status") in ("已开奖", "已完场") for m in i.get("matches", [])))

            return {
                "expert_id": str(eid),
                "expert_name": name,
                "interpretations": all_interpretations,
                "total_count": len(all_interpretations),
                "completed_count": completed,
                "pages": page_no,
            }

        except Exception as e:
            print(f"\n{prefix}: 错误 {e}")
            # 保存当前进度
            checkpoint[eid] = page_no
            save_checkpoint(checkpoint)
            return None


async def batch_scrape(experts: list) -> tuple:
    """阶段2: 并发抓取解读列表"""
    print("\n══════ 阶段2: 批量抓取解读列表 ══════")
    print(f"目标: {len(experts)} 位专家, 并发: {CONFIG['concurrent_experts']}\n")

    checkpoint = load_checkpoint()
    sem = asyncio.Semaphore(CONFIG["concurrent_experts"])

    tasks = [
        scrape_expert(expert, i + 1, len(experts), checkpoint, sem)
        for i, expert in enumerate(experts)
    ]
    results_raw = await asyncio.gather(*tasks)

    results = [r for r in results_raw if r]
    errors = []

    return {"results": results, "errors": errors}


def save_interpretations(results: list, errors: list, experts: list) -> None:
    """保存阶段2 解读数据 (格式与原脚本一致)"""
    out_path = OUTPUT_DIR / "ttyingqiu_interpretations.json"

    flat_list = []
    for r in results:
        for i in r.get("interpretations", []):
            flat_list.append(i)

    completed = [i for i in flat_list
                 if i.get("matches") and any(m.get("status") == "已完场" for m in i["matches"])]

    data = {
        "generated_at": datetime.now().isoformat(),
        "since": CONFIG["since"],
        "experts_scanned": len(experts),
        "success": len(results),
        "errors": len(errors),
        "total_interpretations": len(flat_list),
        "completed_interpretations": len(completed),
        "experts": results,
        "errors": errors,
    }
    save_json(data, out_path)

    size_kb = out_path.stat().st_size / 1024
    print(f"\n[OK] 解读数据已保存: {out_path} ({size_kb:.1f} KB)")

    # 打印汇总
    total_interps = sum(r.get("total_count", 0) for r in results)
    total_completed = sum(r.get("completed_count", 0) for r in results)
    total_pages = sum(r.get("pages", 0) for r in results)
    print("\n══════ 抓取汇总 ══════")
    print(f"  成功: {len(results)} | 失败: {len(errors)}")
    print(f"  总解读: {total_interps} | 已完成: {total_completed}")
    print(f"  总翻页: {total_pages}")


# ═══════════════════════════════════════════════════════
#  阶段3: 抓取解读详情 (并发 + 回填方向)
# ═══════════════════════════════════════════════════════

def parse_detail_page(html: str, interp_id) -> dict:
    """解析详情页 HTML 提取方向+赔率"""
    # 去标签
    text = re.sub(r"<script[\s\S]*?</script>", "", html, flags=re.IGNORECASE)
    text = re.sub(r"<style[\s\S]*?</style>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"&nbsp;", " ", text)
    text = re.sub(r"[\s\n\r]+", " ", text).strip()

    match_blocks = []
    # 匹配比赛行
    match_regex = re.compile(
        r"(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s+(\S+?)\s+(\S+?)\s+(\d+)\s*[-:]\s*(\d+)\s+(\S+)"
    )
    for m in match_regex.finditer(text):
        after = text[m.end() : m.end() + 100].strip()
        pick_match = re.match(r"^(主[胜负]|客[胜负]|让[胜平负]|平局|\S*[胜负]\S*)", after)
        pick = pick_match.group(1) if pick_match else ""

        odds_in = re.search(r"(\d+\.\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)", after)

        match_blocks.append({
            "time": m.group(1),
            "league": m.group(2),
            "home": m.group(3),
            "home_score": int(m.group(4)),
            "away_score": int(m.group(5)),
            "away": m.group(6),
            "pick": pick,
            "spf_odds": {
                "win": float(odds_in.group(1)),
                "draw": float(odds_in.group(2)),
                "lose": float(odds_in.group(3)),
            } if odds_in else None,
        })

    # 提取分析摘要
    analysis = ""
    idx = text.find("推荐理由")
    if idx >= 0:
        analysis = text[idx : idx + 800].strip()
    else:
        analysis = text[:500]

    return {
        "interpretation_id": interp_id,
        "matches": match_blocks,
        "analysis_summary": analysis,
    }


async def fetch_detail(interp_id, sem: asyncio.Semaphore) -> Optional[dict]:
    """抓取单条解读详情"""
    async with sem:
        try:
            html = await http_get(
                f"/interpretation/detail/{interp_id}",
                referer=f"{BASE_URL}/expert/home/",
            )
            return parse_detail_page(html, interp_id)
        except Exception:
            return None


async def scrape_details(interp_results: list) -> list:
    """阶段3: 并发抓取详情"""
    print("\n══════ 阶段3: 抓取解读详情 ══════")

    # 收集已完成比赛的解读
    all_completed = []
    for expert in interp_results:
        for interp in expert.get("interpretations", expert.get("data", [])):
            if interp.get("matches") and any(
                m.get("status") in ("已开奖", "已完场") for m in interp["matches"]
            ):
                all_completed.append(interp)

    print(f"共 {len(all_completed)} 条已完成解读可抓取详情")
    print(f"并发: {CONFIG['concurrent_details']}\n")

    sem = asyncio.Semaphore(CONFIG["concurrent_details"])
    tasks = [fetch_detail(interp["interpretation_id"], sem) for interp in all_completed]

    details_raw = await asyncio.gather(*tasks)
    details = []
    for interp, detail in zip(all_completed, details_raw):
        if detail:
            merged = {**interp, "detail_matches": detail["matches"],
                       "analysis": detail.get("analysis_summary", "")}
            details.append(merged)

    print(f"\n详情抓取完成: {len(details)} 成功, {len(all_completed) - len(details)} 失败")
    return details


def save_details(details: list) -> None:
    """保存阶段3 详情 + 回填方向到解读数据"""
    out_path = OUTPUT_DIR / "ttyingqiu_details.json"

    # 按 interpretation_id 建索引
    detail_map = {d["interpretation_id"]: d for d in details}

    # 回填方向到解读数据
    interp_path = OUTPUT_DIR / "ttyingqiu_interpretations.json"
    if interp_path.exists():
        interp_data = load_json(interp_path)
        for expert in interp_data.get("experts", []):
            for interp in expert.get("interpretations", []):
                did = interp.get("interpretation_id")
                if did in detail_map:
                    dm = detail_map[did]
                    for dmatch in dm.get("detail_matches", []):
                        if not dmatch.get("pick"):
                            continue
                        for imatch in interp.get("matches", []):
                            ht = imatch.get("home_team", "")
                            at = imatch.get("away_team", "")
                            if dmatch["home"] in ht and dmatch["away"] in at:
                                imatch["pick"] = dmatch["pick"] or imatch.get("pick", "")
                                imatch["detail_odds"] = dmatch.get("spf_odds") or imatch.get("detail_odds")
                                break
        save_json(interp_data, interp_path)

    save_json({
        "generated_at": datetime.now().isoformat(),
        "total": len(details),
        "details": details,
    }, out_path)

    size_kb = out_path.stat().st_size / 1024
    print(f"✅ 详情已保存并回填方向: {out_path} ({size_kb:.1f} KB)")
    print(f"   解读数据已更新: {interp_path}")


# ═══════════════════════════════════════════════════════
#  主入口
# ═══════════════════════════════════════════════════════

async def main_async(mode: str):
    start_time = time.time()

    print("╔══════════════════════════════════════════════╗")
    print("║  ttyingqiu.com 专家推荐数据抓取工具 (Python) ║")
    print("║  httpx + asyncio 并发版                      ║")
    print("╚══════════════════════════════════════════════╝\n")

    # 初始化会话
    print("建立会话...")
    await init_session()

    experts = []

    # ── 阶段1: 发现专家 ──
    if mode in ("--discover", "--all"):
        experts = await discover_experts()
    else:
        json_path = OUTPUT_DIR / "ttyingqiu_experts.json"
        if json_path.exists():
            d = load_json(json_path)
            experts = d.get("experts", [])
            if experts:
                print(f"从 ttyingqiu_experts.json 加载 {len(experts)} 位专家")
            else:
                experts = CONFIG["builtin_experts"]
                print(f"专家文件为空, 使用内置 {len(experts)} 位专家")
        else:
            experts = CONFIG["builtin_experts"]
            print(f"使用内置 {len(experts)} 位专家")

    # ── 阶段2: 抓取解读列表 ──
    interp_results = []
    if mode in ("--scrape", "--all"):
        result = await batch_scrape(experts)
        save_interpretations(result["results"], result["errors"], experts)
        interp_results = result["results"]
        # 完成后清理 checkpoint
        if _checkpoint_path.exists():
            _checkpoint_path.unlink()
            print("[OK] checkpoint 已清理")

    # ── 阶段3: 抓取详情 ──
    if mode in ("--detail", "--all"):
        if not interp_results:
            json_path = OUTPUT_DIR / "ttyingqiu_interpretations.json"
            if json_path.exists():
                interp_results = load_json(json_path).get("experts", [])
        if interp_results:
            details = await scrape_details(interp_results)
            save_details(details)

    elapsed = (time.time() - start_time) / 60
    print(f"\n总耗时: {elapsed:.1f} 分钟")

    # 清理
    global _client
    if _client and not _client.is_closed:
        await _client.aclose()


def main():
    # Windows GBK 兼容
    if sys.platform == "win32":
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="ttyingqiu.com 专家推荐数据抓取工具")
    parser.add_argument("mode", nargs="?", default="all",
                        choices=["discover", "scrape", "detail", "all"])
    args = parser.parse_args()

    mode_map = {
        "discover": "--discover",
        "scrape": "--scrape",
        "detail": "--detail",
        "all": "--all",
    }
    try:
        asyncio.run(main_async(mode_map[args.mode]))
    except KeyboardInterrupt:
        print("\n\n[WARN] 用户中断 (checkpoint 已保存)")
        sys.exit(1)
    except Exception as e:
        print(f"\n[FAIL] 失败: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
