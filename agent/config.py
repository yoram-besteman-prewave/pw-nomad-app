"""Configuration for the autonomous agent."""

import os

# Gemini API Configuration
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-2.5-pro-preview-06-05"  # Latest Gemini 2.5 Pro

# Okta Credentials
OKTA_EMAIL = os.getenv("AGENT_OKTA_EMAIL", "")
OKTA_PASSWORD = os.getenv("AGENT_OKTA_PASSWORD", "")

# Browser Settings
HEADLESS = False  # Run with visible browser for debugging
SLOW_MO = 50  # Milliseconds delay between actions

# Okta URLs (will be discovered dynamically)
OKTA_BASE_URL = "https://prewave.okta.com"

# Common app URLs that redirect through Okta
APPS = {
    "figma": "https://www.figma.com",
    "office365": "https://portal.office.com",
    "google": "https://workspace.google.com",
    "slack": "https://prewave.slack.com",
    "jira": "https://prewave.atlassian.net",
}

