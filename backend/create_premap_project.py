#!/usr/bin/env python3
"""Create the CS Premap Jira project and board once.

Run with ATLASSIAN_OAUTH_CLIENT_ID / ATLASSIAN_OAUTH_CLIENT_SECRET configured.
The operation is idempotent: reruns reuse the PREMAP project if it already exists.
"""

import json

from jira_client import JiraClient


def main() -> None:
    client = JiraClient()
    result = client.create_premap_project()
    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    main()
