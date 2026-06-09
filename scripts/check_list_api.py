
import asyncio
import json
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(**p.devices["iPhone 12"])
        page = await context.new_page()
        
        captured_data = []

        async def handle_response(response):
            if "/api/expert/jh/list" in response.url:
                print(f"Captured List URL: {response.url}")
                try:
                    data = await response.json()
                    captured_data.append(data)
                except:
                    print("List Response is not JSON")

        page.on("response", handle_response)
        
        await page.goto("https://m.ttyingqiu.com/#/plan-order/home;id=9150419;gameType=2")
        await asyncio.sleep(10)
        
        with open("list_sample.json", "w", encoding="utf-8") as f:
            json.dump(captured_data, f, ensure_ascii=False, indent=2)
            
        await browser.close()

asyncio.run(main())
