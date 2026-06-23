"""
Autonomous AI Agent - Main Orchestrator

This agent can:
- Sign in through Okta SSO
- Navigate web applications (Figma, Office 365, etc.)
- Assign/unassign software licenses
- Take autonomous actions based on natural language commands
"""

import asyncio
import sys
from pathlib import Path

from browser_controller import BrowserController
from gemini_vision import GeminiVision
from okta_auth import OktaAuth
import config


class AutonomousAgent:
    """Main agent orchestrator."""
    
    def __init__(self):
        self.browser = BrowserController()
        self.vision = GeminiVision()
        self.okta = None
        self.authenticated = False
        self.max_actions = 30  # Safety limit
        
    async def start(self):
        """Initialize the agent."""
        await self.browser.start()
        self.okta = OktaAuth(self.browser, self.vision)
        print("Agent initialized")
        
    async def stop(self):
        """Shut down the agent."""
        await self.browser.stop()
        print("Agent stopped")
        
    async def ensure_authenticated(self) -> bool:
        """Make sure we're logged into Okta."""
        if not self.authenticated:
            self.authenticated = await self.okta.authenticate()
        return self.authenticated
    
    async def execute_task(self, user_query: str) -> dict:
        """
        Execute a task based on natural language input.
        
        Args:
            user_query: Natural language command like "Assign me a Figma license"
            
        Returns:
            dict with status and result
        """
        print(f"\n{'='*60}")
        print(f"TASK: {user_query}")
        print('='*60)
        
        # Parse the task
        task = self.vision.understand_task(user_query)
        print(f"Understood task: {task}")
        
        # Ensure we're authenticated
        if not await self.ensure_authenticated():
            return {"status": "error", "message": "Failed to authenticate with Okta"}
        
        # Navigate to the appropriate app
        app = task.get("application", "").lower()
        if app in config.APPS:
            await self.browser.navigate(config.APPS[app])
        else:
            # Navigate via Okta app dashboard
            await self.browser.navigate(config.OKTA_BASE_URL)
            
        await self.browser.wait(2)
        
        # Execute the task using vision-guided automation
        result = await self._execute_vision_loop(task)
        
        return result
    
    async def _execute_vision_loop(self, task: dict) -> dict:
        """
        Main vision-guided automation loop.
        Takes screenshots, asks Gemini what to do, executes actions.
        """
        task_description = task.get("summary", str(task))
        
        for step in range(self.max_actions):
            print(f"\n--- Step {step + 1} ---")
            
            # Screenshot current state
            screenshot = await self.browser.screenshot(f"step_{step}")
            
            # Ask Gemini what to do
            action = self.vision.analyze_screenshot(screenshot, task_description)
            print(f"Gemini suggests: {action}")
            
            action_type = action.get("action")
            
            if action_type == "done":
                print("✓ Task completed!")
                return {
                    "status": "success",
                    "message": action.get("reasoning", "Task completed"),
                    "steps": step + 1
                }
                
            elif action_type == "error":
                print(f"✗ Error: {action.get('reasoning')}")
                return {
                    "status": "error", 
                    "message": action.get("reasoning", "Unknown error"),
                    "steps": step + 1
                }
                
            # Execute the action
            try:
                await self._execute_action(action)
            except Exception as e:
                print(f"Action failed: {e}")
                # Continue and let Gemini recover
                
            await self.browser.wait(1.5)
            
        return {
            "status": "timeout",
            "message": f"Task did not complete within {self.max_actions} steps"
        }
    
    async def _execute_action(self, action: dict):
        """Execute a single action."""
        action_type = action.get("action")
        target = action.get("target", "")
        value = action.get("value", "")
        
        if action_type == "click":
            if target.startswith("coords:"):
                coords = target.replace("coords:", "").split(",")
                x, y = int(coords[0].strip()), int(coords[1].strip())
                await self.browser.click_coordinates(x, y)
            else:
                success = await self.browser.find_and_click(target)
                if not success:
                    # Try clicking by getting element bounds
                    print(f"Retrying click for: {target}")
                    
        elif action_type == "type":
            # Handle special cases for auth
            if "email" in target.lower() or "username" in target.lower():
                text = config.OKTA_EMAIL
            elif "password" in target.lower():
                text = config.OKTA_PASSWORD
            else:
                text = value
            
            try:
                await self.browser.type_text(target, text, press_enter=False)
            except:
                # Try using keyboard directly
                await self.browser.page.keyboard.type(text)
                
        elif action_type == "scroll":
            direction = "down" if "down" in target.lower() else "up"
            await self.browser.scroll(direction)
            
        elif action_type == "wait":
            await self.browser.wait(3)


async def main():
    """Main entry point."""
    agent = AutonomousAgent()
    
    await agent.start()
    
    try:
        # Interactive mode
        if len(sys.argv) > 1:
            # Command line query
            query = " ".join(sys.argv[1:])
            result = await agent.execute_task(query)
            print(f"\nResult: {result}")
        else:
            # Interactive prompt
            print("\n" + "="*60)
            print("AUTONOMOUS AI AGENT")
            print("="*60)
            print("Enter tasks like:")
            print('  - "I want a full license in Figma"')
            print('  - "Please assign Office 365 access to me"')
            print('  - "Check my license status in Jira"')
            print("Type 'quit' to exit\n")
            
            while True:
                try:
                    query = input("\nYour request: ").strip()
                    if query.lower() in ['quit', 'exit', 'q']:
                        break
                    if not query:
                        continue
                        
                    result = await agent.execute_task(query)
                    print(f"\n📋 Result: {result}")
                    
                except KeyboardInterrupt:
                    break
                    
    finally:
        await agent.stop()


if __name__ == "__main__":
    asyncio.run(main())

