
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(**p.devices["iPhone 12"])
        page = await context.new_page()
        
        async def handle_response(response):
            if "detail" in response.url:
                print(f"Captured Detail URL: {response.url}")
                try:
                    data = await response.json()
                    print(f"Data Keys: {data.keys()}")
                except:
                    print("Response is not JSON")

        page.on("response", handle_response)
        
        # Navigate to an expert page
        print("Navigating to expert home...")
        await page.goto("https://m.ttyingqiu.com/#/plan-order/home;id=9150419;gameType=2")
        await asyncio.sleep(8)
        
        # Click the first plan to go to detail
        # 尝试多个可能的选择器
        plan = await page.query_selector(".jh_item, .plan_li, [class*='item']")
        if plan:
            print(f"Clicking plan... (class: {await plan.get_attribute('class')})")
            await plan.click()
            await asyncio.sleep(5)
        else:
            print("No plan found. Page Content Snippet:")
            content = await page.content()
            print(content[:1000])
            
        await browser.close()

asyncio.run(main())
