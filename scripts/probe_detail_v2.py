
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(**p.devices["iPhone 12"])
        page = await context.new_page()
        
        async def handle_response(response):
            if "/api/" in response.url:
                print(f"API Call: {response.url} ({response.status})")
                if "detail" in response.url:
                    try:
                        text = await response.text()
                        print(f"Detail Data Sample: {text[:200]}")
                    except: pass

        page.on("response", handle_response)
        
        print("Navigating to expert home...")
        await page.goto("https://m.ttyingqiu.com/#/plan-order/home;id=9150419;gameType=2")
        await asyncio.sleep(5)
        
        # Navigate to a detail page URL directly
        print("Navigating to detail page...")
        await page.goto("https://m.ttyingqiu.com/#/plan-order/detail;id=40057")
        await asyncio.sleep(10)
            
        await browser.close()

asyncio.run(main())
