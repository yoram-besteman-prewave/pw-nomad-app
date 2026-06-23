"""Gemini Vision integration for screenshot analysis and decision making."""

import base64
from pathlib import Path
from google import genai
from google.genai import types
import config


class GeminiVision:
    """Uses Gemini 2.5 Pro for vision-based browser automation."""
    
    def __init__(self):
        self.client = genai.Client(api_key=config.GEMINI_API_KEY)
        self.model = config.GEMINI_MODEL
        
    def analyze_screenshot(self, screenshot_path: str, task: str) -> dict:
        """
        Analyze a screenshot and determine what action to take.
        
        Returns a dict with:
        - action: "click", "type", "scroll", "wait", "done", "error"
        - target: element description or coordinates
        - value: text to type (if action is "type")
        - reasoning: explanation of the decision
        """
        with open(screenshot_path, "rb") as f:
            image_data = base64.standard_b64encode(f.read()).decode("utf-8")
        
        prompt = f"""You are an autonomous browser agent. Analyze this screenshot and determine the next action to complete the task.

TASK: {task}

You must respond with a JSON object containing:
- "action": one of "click", "type", "scroll", "wait", "done", "error"
- "target": description of element to interact with, or x,y coordinates like "coords:500,300"
- "value": text to type (only if action is "type")
- "reasoning": brief explanation of why this action

For clicks, describe the element clearly (e.g., "Sign In button", "Email input field", "Figma app tile").
If you see an Okta login page, proceed with authentication.
If the task is complete, use action "done".
If stuck or error, use action "error" with explanation in reasoning.

Respond ONLY with valid JSON, no markdown."""

        response = self.client.models.generate_content(
            model=self.model,
            contents=[
                types.Content(
                    role="user",
                    parts=[
                        types.Part.from_text(text=prompt),
                        types.Part.from_bytes(
                            data=base64.standard_b64decode(image_data),
                            mime_type="image/png"
                        ),
                    ],
                ),
            ],
        )
        
        # Parse the response
        import json
        try:
            result = json.loads(response.text.strip())
            return result
        except json.JSONDecodeError:
            # Try to extract JSON from the response
            text = response.text
            if "```json" in text:
                text = text.split("```json")[1].split("```")[0]
            elif "```" in text:
                text = text.split("```")[1].split("```")[0]
            return json.loads(text.strip())
    
    def analyze_page_state(self, screenshot_path: str) -> dict:
        """Analyze what page we're on and its state."""
        with open(screenshot_path, "rb") as f:
            image_data = base64.standard_b64encode(f.read()).decode("utf-8")
        
        prompt = """Analyze this screenshot and describe:
1. What application/page is shown (e.g., "Okta login", "Figma dashboard", "Office 365 admin")
2. Current state (e.g., "login form visible", "authenticated dashboard", "loading")
3. Any visible errors or messages
4. Key interactive elements visible

Respond with JSON:
{
    "page": "page name",
    "state": "current state",
    "errors": ["any error messages"] or [],
    "elements": ["key interactive elements"]
}"""

        response = self.client.models.generate_content(
            model=self.model,
            contents=[
                types.Content(
                    role="user",
                    parts=[
                        types.Part.from_text(text=prompt),
                        types.Part.from_bytes(
                            data=base64.standard_b64decode(image_data),
                            mime_type="image/png"
                        ),
                    ],
                ),
            ],
        )
        
        import json
        try:
            return json.loads(response.text.strip())
        except:
            return {"page": "unknown", "state": "unknown", "errors": [], "elements": []}

    def understand_task(self, user_query: str) -> dict:
        """Parse a natural language task into structured intent."""
        prompt = f"""Parse this user request into a structured task for a browser automation agent.

USER REQUEST: {user_query}

Common tasks include:
- Assigning software licenses (Figma, Office 365, etc.)
- Unassigning licenses
- Creating accounts
- Checking license status

Respond with JSON:
{{
    "action": "assign_license" | "unassign_license" | "check_status" | "other",
    "application": "figma" | "office365" | "google" | "slack" | "jira" | "other",
    "target_user": "email or name if specified, else 'self'",
    "license_type": "specific license type if mentioned, else 'full'",
    "summary": "brief description of what to do"
}}"""

        response = self.client.models.generate_content(
            model=self.model,
            contents=[types.Content(role="user", parts=[types.Part.from_text(text=prompt)])],
        )
        
        import json
        try:
            return json.loads(response.text.strip())
        except:
            text = response.text
            if "```json" in text:
                text = text.split("```json")[1].split("```")[0]
            elif "```" in text:
                text = text.split("```")[1].split("```")[0]
            return json.loads(text.strip())


if __name__ == "__main__":
    # Test the Gemini connection
    vision = GeminiVision()
    result = vision.understand_task("I want a full license in Figma")
    print("Task understanding test:")
    print(result)

