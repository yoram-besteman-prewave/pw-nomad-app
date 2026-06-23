"""Okta authentication handler."""

import asyncio
from browser_controller import BrowserController
from gemini_vision import GeminiVision
import config


class OktaAuth:
    """Handles Okta SSO authentication."""
    
    def __init__(self, browser: BrowserController, vision: GeminiVision):
        self.browser = browser
        self.vision = vision
        self.max_attempts = 10
        
    async def authenticate(self) -> bool:
        """
        Authenticate through Okta.
        Uses vision to navigate the login flow.
        """
        print("Starting Okta authentication...")
        
        # Navigate to Okta
        await self.browser.navigate(config.OKTA_BASE_URL)
        await self.browser.wait(2)
        
        for attempt in range(self.max_attempts):
            print(f"\nAuth attempt {attempt + 1}/{self.max_attempts}")
            
            # Take screenshot and analyze
            screenshot = await self.browser.screenshot(f"okta_auth_{attempt}")
            state = self.vision.analyze_page_state(screenshot)
            print(f"Page state: {state}")
            
            # Check if we're already authenticated (dashboard visible)
            if self._is_authenticated(state):
                print("✓ Successfully authenticated!")
                return True
            
            # Get next action from Gemini
            action = self.vision.analyze_screenshot(
                screenshot,
                f"Log into Okta with email '{config.OKTA_EMAIL}' and password '{config.OKTA_PASSWORD}'. Complete MFA if needed."
            )
            print(f"Action: {action}")
            
            # Execute the action
            await self._execute_action(action)
            await self.browser.wait(2)
            
            if action.get("action") == "done":
                return True
            elif action.get("action") == "error":
                print(f"Error: {action.get('reasoning')}")
                continue
                
        print("Authentication failed after max attempts")
        return False
    
    def _is_authenticated(self, state: dict) -> bool:
        """Check if we're on an authenticated page."""
        auth_indicators = ["dashboard", "home", "apps", "my apps", "authenticated"]
        page = state.get("page", "").lower()
        page_state = state.get("state", "").lower()
        
        for indicator in auth_indicators:
            if indicator in page or indicator in page_state:
                return True
        return False
    
    async def _execute_action(self, action: dict):
        """Execute an action from Gemini."""
        action_type = action.get("action")
        target = action.get("target", "")
        value = action.get("value", "")
        
        if action_type == "click":
            if target.startswith("coords:"):
                coords = target.replace("coords:", "").split(",")
                x, y = int(coords[0]), int(coords[1])
                await self.browser.click_coordinates(x, y)
            else:
                await self.browser.find_and_click(target)
                
        elif action_type == "type":
            # Determine what to type
            if "email" in target.lower() or "username" in target.lower():
                await self.browser.type_text(target, config.OKTA_EMAIL)
            elif "password" in target.lower():
                await self.browser.type_text(target, config.OKTA_PASSWORD)
            else:
                await self.browser.type_text(target, value)
                
        elif action_type == "scroll":
            await self.browser.scroll()
            
        elif action_type == "wait":
            await self.browser.wait(3)


async def test_okta_auth():
    """Test Okta authentication."""
    browser = BrowserController()
    vision = GeminiVision()
    auth = OktaAuth(browser, vision)
    
    await browser.start()
    try:
        success = await auth.authenticate()
        print(f"\nAuthentication result: {'Success' if success else 'Failed'}")
        
        # Take final screenshot
        await browser.screenshot("final_state")
        await browser.wait(5)
    finally:
        await browser.stop()


if __name__ == "__main__":
    asyncio.run(test_okta_auth())

