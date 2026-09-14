"""T33 mobile QA — 390px viewport checks for the signals view (news pillar),
company page composite card, and the agent model menu, using Playwright."""
import asyncio
from playwright.async_api import async_playwright

BASE = "http://localhost:3000"
OUT = "/home/z/my-project/scripts/data-test"


async def main():
    results = []
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 390, "height": 844})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        # 1) signals view — no horizontal page overflow (table scrolls internally)
        await page.goto(f"{BASE}/?view=signals", wait_until="networkidle", timeout=60000)
        await page.wait_for_timeout(3000)
        sw, cw = await page.evaluate(
            "[document.documentElement.scrollWidth, document.documentElement.clientWidth]"
        )
        results.append(("signals-390 no page overflow", sw <= cw, f"scroll={sw} client={cw}"))
        await page.screenshot(path=f"{OUT}/t33-mobile-signals.png")

        # 2) company page — composite card renders within viewport
        await page.goto(f"{BASE}/?view=company&ticker=EFID", wait_until="networkidle", timeout=60000)
        await page.wait_for_timeout(2500)
        card = await page.query_selector("text=الإشارة المركّبة")
        results.append(("company composite card present", card is not None, ""))
        sw, cw = await page.evaluate(
            "[document.documentElement.scrollWidth, document.documentElement.clientWidth]"
        )
        results.append(("company-390 no page overflow", sw <= cw, f"scroll={sw} client={cw}"))
        if card:
            box = await card.bounding_box()
            results.append(("composite card inside viewport", box is not None and box["x"] >= 0 and box["x"] + box["width"] <= 391, str(box)))
        await page.screenshot(path=f"{OUT}/t33-mobile-company.png")

        # 3) agent view — model chip + menu opens, no overflow
        await page.goto(f"{BASE}/?view=agent", wait_until="networkidle", timeout=60000)
        await page.wait_for_timeout(2000)
        sw, cw = await page.evaluate(
            "[document.documentElement.scrollWidth, document.documentElement.clientWidth]"
        )
        results.append(("agent-390 no page overflow", sw <= cw, f"scroll={sw} client={cw}"))
        chip = page.locator('button[aria-label*="نموذج الذكاء"]').first
        await chip.click(timeout=10000)
        await page.wait_for_timeout(1500)
        menu = await page.query_selector("text=GPT-OSS 20B")
        results.append(("model menu lists GPT-OSS 20B", menu is not None, ""))
        await page.screenshot(path=f"{OUT}/t33-mobile-agent-menu.png")

        results.append(("zero page JS errors", len(errors) == 0, "; ".join(errors)[:200]))
        await browser.close()

    passed = sum(1 for _, ok, _ in results if ok)
    for label, ok, extra in results:
        print(("  PASS " if ok else "  FAIL ") + label + (f"  [{extra}]" if extra else ""))
    print(f"\n{passed}/{len(results)} passed")
    raise SystemExit(0 if passed == len(results) else 1)


asyncio.run(main())
