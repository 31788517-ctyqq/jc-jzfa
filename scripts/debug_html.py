
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(**p.devices["iPhone 12"])
        page = await context.new_page()
        
        await page.goto("https://m.ttyingqiu.com/#/plan-order/detail;id=40057")
        await asyncio.sleep(5)
        
        html = await page.content()
        with open("detail_debug.html", "w", encoding="utf-8") as f:
            f.write(html)
            
        await browser.close()

asyncio.run(main())
