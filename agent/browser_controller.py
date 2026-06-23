"""Browser controller using Playwright for automation."""

import asyncio
import time
from pathlib import Path
from playwright.async_api import async_playwright, Page, Browser
import config


class BrowserController:
    """Controls a Chrome browser for autonomous actions."""
    
    def __init__(self):
        self.browser: Browser = None
        self.page: Page = None
        self.playwright = None
        self.screenshot_dir = Path(__file__).parent / "screenshots"
        self.screenshot_dir.mkdir(exist_ok=True)
        self.screenshot_counter = 0
        
    async def start(self):
        """Start the browser."""
        self.playwright = await async_playwright().start()
        self.browser = await self.playwright.chromium.launch(
            headless=config.HEADLESS,
            slow_mo=config.SLOW_MO,
        )
        self.page = await self.browser.new_page()
        await self.page.set_viewport_size({"width": 1920, "height": 1080})
        print("Browser started")
        
    async def stop(self):
        """Stop the browser."""
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()
        print("Browser stopped")
            
    async def screenshot(self, name: str = None) -> str:
        """Take a screenshot and return the path."""
        self.screenshot_counter += 1
        if name:
            filename = f"{self.screenshot_counter:03d}_{name}.png"
        else:
            filename = f"{self.screenshot_counter:03d}_screenshot.png"
        path = self.screenshot_dir / filename
        await self.page.screenshot(path=str(path), full_page=False)
        print(f"Screenshot saved: {path}")
        return str(path)
    
    async def navigate(self, url: str):
        """Navigate to a URL."""
        print(f"Navigating to: {url}")
        await self.page.goto(url, wait_until="networkidle")
        await asyncio.sleep(1)  # Extra wait for dynamic content
        
    async def click_element(self, selector_or_text: str):
        """Click an element by selector or visible text."""
        try:
            # Try as selector first
            if selector_or_text.startswith((".", "#", "[", "//", "button", "input", "a")):
                await self.page.click(selector_or_text)
            else:
                # Try to find by text
                element = self.page.get_by_text(selector_or_text, exact=False).first
                await element.click()
            print(f"Clicked: {selector_or_text}")
        except Exception as e:
            print(f"Click failed for '{selector_or_text}': {e}")
            raise
            
    async def click_coordinates(self, x: int, y: int):
        """Click at specific coordinates."""
        await self.page.mouse.click(x, y)
        print(f"Clicked at coordinates: ({x}, {y})")
        
    async def type_text(self, selector_or_text: str, text: str, press_enter: bool = False):
        """Type text into an input field."""
        try:
            if selector_or_text.startswith((".", "#", "[", "//", "input", "textarea")):
                await self.page.fill(selector_or_text, text)
            else:
                # Find by placeholder or label
                element = self.page.get_by_placeholder(selector_or_text).or_(
                    self.page.get_by_label(selector_or_text)
                ).first
                await element.fill(text)
            print(f"Typed into '{selector_or_text}'")
            
            if press_enter:
                await self.page.keyboard.press("Enter")
                print("Pressed Enter")
        except Exception as e:
            print(f"Type failed for '{selector_or_text}': {e}")
            raise
            
    async def scroll(self, direction: str = "down", amount: int = 500):
        """Scroll the page."""
        if direction == "down":
            await self.page.mouse.wheel(0, amount)
        else:
            await self.page.mouse.wheel(0, -amount)
        print(f"Scrolled {direction}")
        
    async def wait(self, seconds: float = 2):
        """Wait for a specified time."""
        print(f"Waiting {seconds} seconds...")
        await asyncio.sleep(seconds)
        
    async def get_page_content(self) -> str:
        """Get the current page's text content."""
        return await self.page.inner_text("body")
    
    async def find_and_click(self, description: str) -> bool:
        """Use various strategies to find and click an element."""
        strategies = [
            # By role and name
            lambda: self.page.get_by_role("button", name=description).click(),
            lambda: self.page.get_by_role("link", name=description).click(),
            # By text
            lambda: self.page.get_by_text(description, exact=False).first.click(),
            # By label
            lambda: self.page.get_by_label(description).click(),
            # By placeholder
            lambda: self.page.get_by_placeholder(description).click(),
            # By test id
            lambda: self.page.get_by_test_id(description).click(),
        ]
        
        for strategy in strategies:
            try:
                await strategy()
                print(f"Successfully clicked: {description}")
                return True
            except:
                continue
        
        print(f"Could not find element: {description}")
        return False


async def test_browser():
    """Test basic browser functionality."""
    controller = BrowserController()
    await controller.start()
    
    try:
        await controller.navigate("https://www.google.com")
        await controller.screenshot("google_home")
        await controller.wait(2)
    finally:
        await controller.stop()


if __name__ == "__main__":
    asyncio.run(test_browser())

