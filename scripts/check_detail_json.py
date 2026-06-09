
import asyncio
import json
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(**p.devices["iPhone 12"])
        page = await context.new_page()
        
        detail_data = None
        async def handle_response(response):
            nonlocal detail_data
            if "/api/expert/jh/detail" in response.url:
                try:
                    detail_data = await response.json()
                except: pass

        page.on("response", handle_response)
        await page.goto("https://m.ttyingqiu.com/#/plan-order/detail;id=40057")
        await asyncio.sleep(5)
        
        if detail_data:
            with open("detail_sample.json", "w", encoding="utf-8") as f:
                json.dump(detail_data, f, ensure_ascii=False, indent=2)
            print("Detail saved to detail_sample.json")
        else:
            print("Failed to capture detail")
            
        await browser.close()

asyncio.run(main())
