import asyncio
from playwright.async_api import async_playwright
import json

async def discover_experts():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 375, "height": 812})
        
        url = "https://m.ttyingqiu.com/#/tabs/expert;tab=3"
        print(f"正在访问 {url}...")
        await page.goto(url)
        await page.wait_for_selector(".exConList_li", timeout=10000)
        
        experts = []
        # 提取专家 ID。由于 ID 在跳转逻辑中，我们需要点击或者从数据中捕获。
        # 我们可以拦截点击后的 URL，或者直接获取数据。
        
        # 方案：拦截 API 请求
        expert_list_data = []
        async def handle_response(response):
            if "/api/home/jh/expert/list/" in response.url:
                try:
                    data = await response.json()
                    expert_list_data.append(data)
                except:
                    pass
        
        page.on("response", handle_response)
        
        await page.goto(url)
        # 等待 API 请求完成
        try:
            await page.wait_for_response(lambda res: "/api/home/jh/expert/list/" in res.url, timeout=10000)
        except:
            print("等待 API 响应超时")
            
        # 滚动一下触发更多加载
        await page.mouse.wheel(0, 2000)
        await asyncio.sleep(2)
        
        for data in expert_list_data:
            if "page" in data and "dataList" in data["page"]:
                for item in data["page"]["dataList"]:
                    member = item.get("jcobMember", {})
                    expert = {
                        "id": str(member.get("id")),
                        "name": member.get("nickName"),
                        "streak": item.get("currentLianhongCount", 0),
                        "followers": item.get("withRedMemberCount", 0)
                    }
                    if expert["id"] and expert["id"] != "None":
                        experts.append(expert)
        
        # 去重
        seen = set()
        unique_experts = []
        for e in experts:
            if e["id"] not in seen:
                unique_experts.append(e)
                seen.add(e["id"])
        
        print(f"发现 {len(unique_experts)} 位专家")
        await browser.close()
        return unique_experts

if __name__ == "__main__":
    experts = asyncio.run(discover_experts())
    print(json.dumps(experts, ensure_ascii=False, indent=2))
