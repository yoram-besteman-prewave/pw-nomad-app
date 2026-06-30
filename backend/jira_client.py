import os
import httpx
from datetime import datetime, timedelta
from typing import Optional
from models import Ticket, Comment


class JiraClient:
    LINES_FIELD = "customfield_10142"  # Total Count field
    SCREENING_DUE_DATE_FIELD = "customfield_10127"  # Screening Due date field
    SCREENING_LIST_LINK_FIELD = "customfield_10128"  # Screening List Link (URL)
    APPROVED_STATUS = "Approved"  # Status that allows scheduling
    JUMPED_STATUS = "Jumped"  # Status when ticket week has started and it's been processed
    
    # Project keys
    PRES_PROJECT_KEY = "PRES"  # Pre-screening project
    FST_PROJECT_KEY = "FST"   # Full screening team project
    PREMAP_PROJECT_KEY = os.getenv("PREMAP_PROJECT_KEY", "PREMAP")  # Tier-N pre-mapping project
    
    # OAuth 2.0 credentials for NoMAD App service account
    # This will show as "NoMAD App" in Jira history
    OAUTH_CLIENT_ID = os.getenv("ATLASSIAN_OAUTH_CLIENT_ID", "")
    OAUTH_CLIENT_SECRET = os.getenv("ATLASSIAN_OAUTH_CLIENT_SECRET", "")
    OAUTH_TOKEN_URL = "https://api.atlassian.com/oauth/token"
    ATLASSIAN_API_BASE = "https://api.atlassian.com"
    
    # Cached token
    _access_token: Optional[str] = None
    _token_expires_at: Optional[datetime] = None
    _cloud_id: Optional[str] = None
    
    def __init__(self):
        self._ensure_token()
    
    def _get_access_token(self) -> str:
        """Get OAuth access token using client credentials flow"""
        print("[Jira] Getting new OAuth access token...")

        if not self.OAUTH_CLIENT_ID or not self.OAUTH_CLIENT_SECRET:
            raise RuntimeError(
                "Atlassian OAuth credentials are not configured. Set "
                "ATLASSIAN_OAUTH_CLIENT_ID and ATLASSIAN_OAUTH_CLIENT_SECRET."
            )
        
        with httpx.Client(timeout=30.0) as client:
            response = client.post(
                self.OAUTH_TOKEN_URL,
                data={
                    "grant_type": "client_credentials",
                    "client_id": self.OAUTH_CLIENT_ID,
                    "client_secret": self.OAUTH_CLIENT_SECRET,
                }
            )
            response.raise_for_status()
            token_data = response.json()
            
            JiraClient._access_token = token_data["access_token"]
            expires_in = token_data.get("expires_in", 3600)
            # Refresh 5 minutes before expiry
            JiraClient._token_expires_at = datetime.utcnow() + timedelta(seconds=expires_in - 300)
            
            print(f"[Jira] Got access token, expires in {expires_in}s")
            return JiraClient._access_token
    
    def _get_cloud_id(self) -> str:
        """Get the Atlassian Cloud ID for prewave"""
        if JiraClient._cloud_id:
            return JiraClient._cloud_id
        
        print("[Jira] Getting Cloud ID...")
        headers = {"Authorization": f"Bearer {self._ensure_token()}"}
        
        with httpx.Client(timeout=30.0) as client:
            response = client.get(
                f"{self.ATLASSIAN_API_BASE}/oauth/token/accessible-resources",
                headers=headers
            )
            response.raise_for_status()
            resources = response.json()
            
            if not resources:
                raise Exception("No accessible Atlassian resources found")
            
            # Find prewave site
            for resource in resources:
                if "prewave" in resource.get("name", "").lower():
                    JiraClient._cloud_id = resource["id"]
                    print(f"[Jira] Found Cloud ID: {JiraClient._cloud_id}")
                    return JiraClient._cloud_id
            
            # Default to first resource
            JiraClient._cloud_id = resources[0]["id"]
            print(f"[Jira] Using Cloud ID: {JiraClient._cloud_id}")
            return JiraClient._cloud_id
    
    def _ensure_token(self) -> str:
        """Ensure we have a valid access token"""
        if (JiraClient._access_token is None or 
            JiraClient._token_expires_at is None or 
            datetime.utcnow() >= JiraClient._token_expires_at):
            return self._get_access_token()
        return JiraClient._access_token
    
    @property
    def base_url(self) -> str:
        """Get the Jira API base URL"""
        cloud_id = self._get_cloud_id()
        return f"{self.ATLASSIAN_API_BASE}/ex/jira/{cloud_id}/rest/api/3"

    @property
    def agile_base_url(self) -> str:
        """Get the Jira Software Agile API base URL"""
        cloud_id = self._get_cloud_id()
        return f"{self.ATLASSIAN_API_BASE}/ex/jira/{cloud_id}/rest/agile/1.0"
    
    def _get_headers(self) -> dict:
        """Get authorization headers"""
        return {"Authorization": f"Bearer {self._ensure_token()}"}
    
    def _make_request(self, method: str, endpoint: str, **kwargs) -> dict:
        """Make an authenticated request to Jira API"""
        url = f"{self.base_url}/{endpoint}"
        headers = self._get_headers()
        
        with httpx.Client(timeout=30.0) as client:
            response = client.request(method, url, headers=headers, **kwargs)
            response.raise_for_status()
            if response.status_code == 204 or not response.content:
                return {}
            return response.json()

    def _make_agile_request(self, method: str, endpoint: str, **kwargs) -> dict:
        """Make an authenticated request to Jira Software Agile API"""
        url = f"{self.agile_base_url}/{endpoint}"
        headers = self._get_headers()

        with httpx.Client(timeout=30.0) as client:
            response = client.request(method, url, headers=headers, **kwargs)
            response.raise_for_status()
            if response.status_code == 204 or not response.content:
                return {}
            return response.json()
    
    def _search_issues(self, jql: str, fields: list[str], max_results: int = 500) -> list[dict]:
        """Search issues using the new /search/jql endpoint (POST)"""
        payload = {
            "jql": jql,
            "fields": fields,
            "maxResults": max_results,
        }
        result = self._make_request("POST", "search/jql", json=payload)
        return result.get("issues", [])

    def _scheme_id_from_project_response(self, response: dict, scheme_key: str, id_key: str = "id") -> Optional[int]:
        """Extract a scheme id from Jira's project-to-scheme lookup response."""
        values = response.get("values") or []
        if not values:
            return None

        scheme = values[0].get(scheme_key) or {}
        scheme_id = scheme.get(id_key)
        return int(scheme_id) if scheme_id is not None else None

    def _project_exists(self, project_key: str) -> Optional[dict]:
        """Return project data if a Jira project exists, otherwise None."""
        try:
            return self._make_request("GET", f"project/{project_key}")
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return None
            raise

    def _get_premap_project_payload(self, source_project_key: str, target_project_key: str, target_name: str) -> dict:
        """Build a company-managed project payload that shares PRES's schemes."""
        source_project = self._make_request("GET", f"project/{source_project_key}")
        source_project_id = source_project.get("id")
        if not source_project_id:
            raise RuntimeError(f"Could not determine project id for {source_project_key}")

        workflow_scheme_id = self._scheme_id_from_project_response(
            self._make_request("GET", f"workflowscheme/project?projectId={source_project_id}"),
            "workflowScheme",
        )
        issue_type_scheme_id = self._scheme_id_from_project_response(
            self._make_request("GET", f"issuetypescheme/project?projectId={source_project_id}"),
            "issueTypeScheme",
        )
        issue_type_screen_scheme_id = self._scheme_id_from_project_response(
            self._make_request("GET", f"issuetypescreenscheme/project?projectId={source_project_id}"),
            "issueTypeScreenScheme",
        )
        field_configuration_scheme_id = self._scheme_id_from_project_response(
            self._make_request("GET", f"fieldconfigurationscheme/project?projectId={source_project_id}"),
            "fieldConfigurationScheme",
        )
        permission_scheme = self._make_request("GET", f"project/{source_project_key}/permissionscheme")
        notification_scheme_response = self._make_request("GET", f"notificationscheme/project?projectId={source_project_id}")
        notification_values = notification_scheme_response.get("values") or []

        lead = source_project.get("lead") or {}
        lead_account_id = lead.get("accountId")
        if not lead_account_id:
            raise RuntimeError(f"Could not determine project lead for {source_project_key}")

        payload = {
            "key": target_project_key,
            "name": target_name,
            "projectTypeKey": source_project.get("projectTypeKey", "software"),
            "description": f"Tier-N requests project mirrored from {source_project_key}.",
            "leadAccountId": lead_account_id,
            "assigneeType": source_project.get("assigneeType", "UNASSIGNED"),
        }

        category = source_project.get("projectCategory") or {}
        if category.get("id"):
            payload["categoryId"] = int(category["id"])

        if workflow_scheme_id:
            payload["workflowScheme"] = workflow_scheme_id
        if issue_type_scheme_id:
            payload["issueTypeScheme"] = issue_type_scheme_id
        if issue_type_screen_scheme_id:
            payload["issueTypeScreenScheme"] = issue_type_screen_scheme_id
        if field_configuration_scheme_id:
            payload["fieldConfigurationScheme"] = field_configuration_scheme_id
        if permission_scheme.get("id"):
            payload["permissionScheme"] = int(permission_scheme["id"])
        if notification_values and notification_values[0].get("notificationSchemeId"):
            payload["notificationScheme"] = int(notification_values[0]["notificationSchemeId"])

        return payload

    def _copy_project_role_actors(self, source_project_key: str, target_project_key: str) -> list[dict]:
        """Copy project-role actors from PRES into the target project."""
        copied_roles = []
        source_roles = self._make_request("GET", f"project/{source_project_key}/role")

        for role_name, role_url in source_roles.items():
            role_id = role_url.rstrip("/").split("/")[-1]
            source_role = self._make_request("GET", f"project/{source_project_key}/role/{role_id}")
            target_role = self._make_request("GET", f"project/{target_project_key}/role/{role_id}")
            actors = source_role.get("actors") or []
            target_actors = target_role.get("actors") or []
            existing_users = {
                (actor.get("actorUser") or {}).get("accountId")
                for actor in target_actors
                if (actor.get("actorUser") or {}).get("accountId")
            }
            existing_group_ids = {
                (actor.get("actorGroup") or {}).get("groupId")
                for actor in target_actors
                if (actor.get("actorGroup") or {}).get("groupId")
            }
            existing_groups = {
                (actor.get("actorGroup") or {}).get("name")
                for actor in target_actors
                if (actor.get("actorGroup") or {}).get("name")
            }
            users = []
            groups = []
            group_ids = []

            for actor in actors:
                actor_user = actor.get("actorUser") or {}
                account_id = actor_user.get("accountId")
                if account_id and account_id not in existing_users:
                    users.append(account_id)
                    continue

                actor_group = actor.get("actorGroup") or {}
                group_id = actor_group.get("groupId")
                group_name = actor_group.get("name")
                if group_id and group_id not in existing_group_ids:
                    group_ids.append(group_id)
                elif group_name and group_name not in existing_groups:
                    groups.append(group_name)

            payload = {}
            if users:
                payload["user"] = users
            if group_ids:
                payload["groupId"] = group_ids
            if groups:
                payload["group"] = groups

            if not payload:
                copied_roles.append({"role": role_name, "actors": 0, "status": "already_synced"})
                continue

            try:
                self._make_request("POST", f"project/{target_project_key}/role/{role_id}", json=payload)
                copied_roles.append({"role": role_name, "actors": len(users) + len(group_ids) + len(groups), "status": "copied"})
            except httpx.HTTPStatusError as e:
                # Some Jira role actors may be implicitly inherited or auto-added by project creation.
                # Keep copying the remaining roles and surface the per-role warning in the result.
                copied_roles.append({
                    "role": role_name,
                    "actors": len(users) + len(group_ids) + len(groups),
                    "status": "warning",
                    "error": f"{e.response.status_code}: {e.response.text[:300]}",
                })

        return copied_roles

    def _create_premap_filter(self, target_project_key: str, filter_name: str) -> dict:
        """Create or reuse a Jira filter for the Tier-N project."""
        jql = f"project = {target_project_key} ORDER BY Rank ASC"
        created_filter = None

        try:
            existing = self._make_request("GET", "filter/search", params={"filterName": filter_name})
            for candidate in existing.get("values", []):
                if candidate.get("name") == filter_name:
                    created_filter = candidate
                    break
        except httpx.HTTPStatusError as e:
            print(f"[NoMAD] Could not search for existing {board_name} filter: {e}")

        if not created_filter:
            created_filter = self._make_request("POST", "filter", json={
                "name": filter_name,
                "description": f"Filter for {filter_name}.",
                "jql": jql,
                "favourite": False,
            })

        return created_filter

    def _create_premap_board(self, filter_id: str, board_name: str) -> dict:
        """Create or reuse a Jira Software board for the Tier-N project."""
        try:
            boards = self._make_agile_request("GET", "board", params={"name": board_name})
            for board in boards.get("values", []):
                if board.get("name") == board_name:
                    return {"board": board, "board_created": False}
        except httpx.HTTPStatusError as e:
            print(f"[NoMAD] Could not search Jira Software boards for {board_name}: {e}")

        board = self._make_agile_request("POST", "board", json={
            "name": board_name,
            "type": "kanban",
            "filterId": int(filter_id),
        })
        return {"board": board, "board_created": True}

    def create_premap_project(self) -> dict:
        """
        Create the CS Premap project and board by sharing PRES's company-managed schemes.

        The project creation is idempotent. Board creation depends on Jira Software Agile API
        scopes; if those scopes are absent, the returned result includes a board warning.
        """
        source_project_key = self.PRES_PROJECT_KEY
        target_project_key = self.PREMAP_PROJECT_KEY
        board_name = "CS Premap"

        result = {
            "project_key": target_project_key,
            "project_created": False,
            "roles_copied": [],
            "filter": None,
            "board": None,
            "warnings": [],
        }

        existing_project = self._project_exists(target_project_key)
        if existing_project:
            result["project"] = existing_project
            print(f"[NoMAD] Jira project {target_project_key} already exists")
        else:
            payload = self._get_premap_project_payload(source_project_key, target_project_key, board_name)
            created_project = self._make_request("POST", "project", json=payload)
            result["project"] = created_project
            result["project_created"] = True
            print(f"[NoMAD] Created Jira project {target_project_key} ({board_name})")

        try:
            result["roles_copied"] = self._copy_project_role_actors(source_project_key, target_project_key)
        except httpx.HTTPStatusError as e:
            warning = f"Could not copy project role actors: {e.response.status_code} {e.response.text[:500]}"
            print(f"[NoMAD] {warning}")
            result["warnings"].append(warning)

        try:
            created_filter = self._create_premap_filter(target_project_key, board_name)
            result["filter"] = created_filter
        except httpx.HTTPStatusError as e:
            warning = f"Could not create Jira filter. HTTP {e.response.status_code}: {e.response.text[:500]}"
            print(f"[NoMAD] {warning}")
            result["warnings"].append(warning)

        filter_id = (result["filter"] or {}).get("id")
        if filter_id:
            try:
                board_result = self._create_premap_board(filter_id, board_name)
                result["board"] = board_result["board"]
                result["board_created"] = board_result["board_created"]
            except httpx.HTTPStatusError as e:
                warning = (
                    "Could not create Jira Software board. "
                    f"HTTP {e.response.status_code}: {e.response.text[:500]}"
                )
                print(f"[NoMAD] {warning}")
                result["warnings"].append(warning)
        else:
            result["warnings"].append("Skipped Jira Software board creation because no filter id was available.")

        return result
    
    def _parse_lines(self, lines_value) -> tuple[int, bool]:
        """Parse the lines custom field value. Returns (lines, has_value)"""
        if lines_value is None:
            return 0, False
        
        if isinstance(lines_value, (int, float)):
            return int(lines_value), True
        
        if isinstance(lines_value, str):
            try:
                cleaned = lines_value.replace(',', '').replace(' ', '').strip()
                if not cleaned:
                    return 0, False
                return int(float(cleaned)), True
            except (ValueError, TypeError):
                return 0, False
        
        if isinstance(lines_value, dict):
            if 'value' in lines_value:
                return self._parse_lines(lines_value['value'])
            if 'name' in lines_value:
                return self._parse_lines(lines_value['name'])
        
        if hasattr(lines_value, 'value'):
            return self._parse_lines(lines_value.value)
        
        try:
            return int(float(str(lines_value))), True
        except (ValueError, TypeError):
            return 0, False

    def _is_approved(self, status: str) -> bool:
        """Check if the ticket status indicates it's approved for scheduling"""
        return status.lower() == self.APPROVED_STATUS.lower()

    def _get_comments(self, issue_key: str) -> list[Comment]:
        """Fetch comments separately for an issue"""
        comments = []
        try:
            result = self._make_request("GET", f"issue/{issue_key}/comment")
            issue_comments = result.get("comments", [])[-5:]  # Last 5 comments
            
            for c in issue_comments:
                author_name = "Unknown"
                author = c.get("author", {})
                author_name = author.get("displayName") or author.get("name") or "Unknown"
                
                body = ""
                body_content = c.get("body")
                if body_content:
                    if isinstance(body_content, dict):
                        body = self._extract_text_from_adf(body_content)[:500]
                    else:
                        body = str(body_content)[:500]
                
                created = datetime.now()
                created_str = c.get("created")
                if created_str:
                    try:
                        created = datetime.fromisoformat(created_str.replace('Z', '+00:00'))
                    except:
                        pass
                
                comments.append(Comment(
                    author=author_name,
                    body=body,
                    created=created
                ))
        except Exception as e:
            print(f"Error fetching comments for {issue_key}: {e}")
        return comments
    
    def get_screening_tickets(self, project_key: str | None = None) -> list[Ticket]:
        """Fetch screening tickets - including those without Total Count"""
        effective_project_key = project_key or self.PRES_PROJECT_KEY
        jql = f"project = {effective_project_key} AND status != Done ORDER BY created DESC"
        
        fields = [
            "summary",
            "description",
            "status",
            "assignee",
            "created",
            "duedate",
            self.SCREENING_LIST_LINK_FIELD,
            self.LINES_FIELD
        ]
        
        issues = self._search_issues(jql, fields, max_results=500)
        
        tickets = []
        for issue in issues:
            issue_key = issue.get("key")
            fields_data = issue.get("fields", {})
            
            lines_value = fields_data.get(self.LINES_FIELD)
            lines, has_total_count = self._parse_lines(lines_value)

            has_screening_link = bool(fields_data.get(self.SCREENING_LIST_LINK_FIELD))
            
            status_obj = fields_data.get("status", {})
            status_str = status_obj.get("name", "Unknown") if isinstance(status_obj, dict) else str(status_obj)
            is_approved = self._is_approved(status_str)
            is_jumped_status = self.is_jumped(status_str)
            
            assignee_name = None
            assignee = fields_data.get("assignee")
            if assignee:
                assignee_name = assignee.get("displayName") or assignee.get("name")
            
            created_dt = datetime.now()
            created_str = fields_data.get("created")
            if created_str:
                try:
                    created_dt = datetime.fromisoformat(created_str.replace('Z', '+00:00'))
                except:
                    pass
            
            # Parse due date
            due_date = None
            duedate_str = fields_data.get("duedate")
            if duedate_str:
                try:
                    due_date = datetime.fromisoformat(duedate_str)
                except:
                    pass
            
            # Get description
            description = None
            desc = fields_data.get("description")
            if desc:
                if isinstance(desc, dict):
                    description = self._extract_text_from_adf(desc)
                else:
                    description = str(desc)[:2000]
            
            # Fetch comments separately
            comments = self._get_comments(issue_key)
            
            summary = fields_data.get("summary", "")
            
            tickets.append(Ticket(
                key=issue_key,
                summary=summary,
                description=description,
                lines=lines,
                status=status_str,
                assignee=assignee_name,
                created=created_dt,
                comments=comments,
                has_total_count=has_total_count,
                has_screening_link=has_screening_link,
                is_approved=is_approved,
                due_date=due_date,
                is_jumped=is_jumped_status
            ))
        
        return tickets
    
    def _extract_text_from_adf(self, adf: dict, max_length: int = 2000) -> str:
        """Extract plain text from Atlassian Document Format"""
        text_parts = []
        
        def extract(node):
            if isinstance(node, dict):
                if node.get('type') == 'text':
                    text_parts.append(node.get('text', ''))
                for child in node.get('content', []):
                    extract(child)
            elif isinstance(node, list):
                for item in node:
                    extract(item)
        
        try:
            extract(adf)
            result = ' '.join(text_parts)
            return result[:max_length] if result else None
        except:
            return str(adf)[:max_length]
    
    def get_ticket_details(self, ticket_key: str) -> Optional[Ticket]:
        """Get details for a specific ticket"""
        try:
            fields_param = ",".join([
                "summary",
                "description",
                "status",
                "assignee",
                "created",
                "duedate",
                self.SCREENING_LIST_LINK_FIELD,
                self.LINES_FIELD
            ])
            issue = self._make_request("GET", f"issue/{ticket_key}?fields={fields_param}")
            
            fields_data = issue.get("fields", {})
            
            lines_value = fields_data.get(self.LINES_FIELD)
            lines, has_total_count = self._parse_lines(lines_value)

            has_screening_link = bool(fields_data.get(self.SCREENING_LIST_LINK_FIELD))
            
            status_obj = fields_data.get("status", {})
            status_str = status_obj.get("name", "Unknown") if isinstance(status_obj, dict) else str(status_obj)
            is_approved = self._is_approved(status_str)
            is_jumped_status = self.is_jumped(status_str)
            
            assignee_name = None
            assignee = fields_data.get("assignee")
            if assignee:
                assignee_name = assignee.get("displayName") or assignee.get("name")
            
            created_dt = datetime.now()
            created_str = fields_data.get("created")
            if created_str:
                try:
                    created_dt = datetime.fromisoformat(created_str.replace('Z', '+00:00'))
                except:
                    pass
            
            due_date = None
            duedate_str = fields_data.get("duedate")
            if duedate_str:
                try:
                    due_date = datetime.fromisoformat(duedate_str)
                except:
                    pass
            
            description = None
            desc = fields_data.get("description")
            if desc:
                if isinstance(desc, dict):
                    description = self._extract_text_from_adf(desc)
                else:
                    description = str(desc)[:2000]
            
            comments = self._get_comments(ticket_key)
            
            return Ticket(
                key=issue.get("key"),
                summary=fields_data.get("summary", ""),
                description=description,
                lines=lines,
                status=status_str,
                assignee=assignee_name,
                created=created_dt,
                comments=comments,
                has_total_count=has_total_count,
                has_screening_link=has_screening_link,
                is_approved=is_approved,
                due_date=due_date,
                is_jumped=is_jumped_status
            )
        except Exception as e:
            print(f"Error fetching ticket {ticket_key}: {e}")
            return None
    
    def update_due_date(self, ticket_key: str, week: int, year: int, lines: int = 0, weekly_capacity: int = 4000) -> tuple[bool, int, int]:
        """
        Update the due date of a ticket to the end (Friday) of the final week it spans.
        
        For tickets larger than weekly capacity, calculates how many weeks they span
        and sets due date to Friday of the final week.
        
        Returns: (success, final_week, final_year)
        """
        try:
            # Calculate how many weeks this ticket spans
            if lines > 0 and lines > weekly_capacity:
                weeks_needed = (lines + weekly_capacity - 1) // weekly_capacity  # Ceiling division
            else:
                weeks_needed = 1
            
            # Calculate the final week (add weeks_needed - 1 to start week)
            final_week = week + weeks_needed - 1
            final_year = year
            
            # Handle year rollover
            while final_week > 52:
                final_week -= 52
                final_year += 1
            
            # Calculate the Friday of the final week
            jan4 = datetime(final_year, 1, 4)  # Jan 4 is always in week 1
            days_to_monday = jan4.weekday()
            week1_monday = jan4 - timedelta(days=days_to_monday)
            target_monday = week1_monday + timedelta(weeks=final_week - 1)
            friday = target_monday + timedelta(days=4)  # Friday
            
            due_date_str = friday.strftime('%Y-%m-%d')
            
            # Update both the standard duedate AND the Screening Due date custom field
            payload = {
                "fields": {
                    "duedate": due_date_str,
                    self.SCREENING_DUE_DATE_FIELD: due_date_str
                }
            }
            
            url = f"{self.base_url}/issue/{ticket_key}"
            headers = self._get_headers()
            
            with httpx.Client(timeout=30.0) as client:
                response = client.put(url, headers=headers, json=payload)
                response.raise_for_status()
            
            if weeks_needed > 1:
                print(f"[NoMAD App] Updated {ticket_key}: duedate={due_date_str} (spans {weeks_needed} weeks: W{week}-W{final_week}/{final_year})")
            else:
                print(f"[NoMAD App] Updated {ticket_key}: duedate={due_date_str}")
            
            return True, final_week, final_year
        except Exception as e:
            print(f"Error updating due date for {ticket_key}: {e}")
            return False, week, year
    
    def clear_due_date(self, ticket_key: str) -> bool:
        """Clear the due date of a ticket (used for resetting mismatched tickets)"""
        try:
            # Set both duedate fields to null
            payload = {
                "fields": {
                    "duedate": None,
                    self.SCREENING_DUE_DATE_FIELD: None
                }
            }
            
            url = f"{self.base_url}/issue/{ticket_key}"
            headers = self._get_headers()
            
            with httpx.Client(timeout=30.0) as client:
                response = client.put(url, headers=headers, json=payload)
                response.raise_for_status()
            
            print(f"[NoMAD App] Cleared due date for {ticket_key}")
            return True
        except Exception as e:
            print(f"Error clearing due date for {ticket_key}: {e}")
            return False
    
    def is_user_in_group(self, email: str, group_name: str) -> bool:
        """Check if a user is a member of a specific Atlassian group"""
        try:
            # Search for user by email
            result = self._make_request("GET", f"user/search?query={email}")
            
            if not result:
                print(f"User not found: {email}")
                return False
            
            account_id = result[0].get("accountId")
            if not account_id:
                print(f"No account ID found for: {email}")
                return False
            
            # Check group membership
            groups_result = self._make_request("GET", f"user/groups?accountId={account_id}")
            
            for group in groups_result:
                if group.get("name") == group_name:
                    print(f"User {email} is in group {group_name}")
                    return True
            
            print(f"User {email} is NOT in group {group_name}")
            return False
            
        except Exception as e:
            print(f"Error checking group membership for {email}: {e}")
            return False

    def get_transitions(self, ticket_key: str, include_unavailable: bool = False) -> list[dict]:
        """Get available transitions for a ticket.

        Args:
            include_unavailable: When True, adds ?includeUnavailableTransitions=true so that
                transitions hidden by workflow conditions are still returned in the list.
                This is needed when the NoMAD App service account doesn't satisfy a condition
                that would otherwise show the transition.
        """
        try:
            params = {"includeUnavailableTransitions": "true"} if include_unavailable else None
            result = self._make_request("GET", f"issue/{ticket_key}/transitions", params=params)
            return result.get("transitions", [])
        except Exception as e:
            print(f"Error getting transitions for {ticket_key}: {e}")
            return []

    def transition_to_jumped(self, ticket_key: str) -> bool:
        """Transition a ticket to 'Jumped' status"""
        try:
            transitions = self.get_transitions(ticket_key)
            
            # Find the "Jumped" transition
            jumped_transition = None
            for t in transitions:
                if t.get("name", "").lower() == self.JUMPED_STATUS.lower():
                    jumped_transition = t
                    break
                # Also check the "to" status name
                to_status = t.get("to", {}).get("name", "")
                if to_status.lower() == self.JUMPED_STATUS.lower():
                    jumped_transition = t
                    break
            
            if not jumped_transition:
                print(f"[NoMAD] No 'Jumped' transition available for {ticket_key}. Available: {[t.get('name') for t in transitions]}")
                return False
            
            # Execute the transition
            payload = {"transition": {"id": jumped_transition["id"]}}
            self._make_request("POST", f"issue/{ticket_key}/transitions", json=payload)
            
            print(f"[NoMAD] Transitioned {ticket_key} to Jumped status")
            return True
        except Exception as e:
            print(f"Error transitioning {ticket_key} to Jumped: {e}")
            return False

    def transition_to_approved(self, ticket_key: str) -> dict:
        """Transition a ticket to 'Approved' status. Returns dict with success and optional error.

        The PRES workflow's 'Approve' transition is conditional, which can cause Jira to hide it
        from the NoMAD App service account.  We therefore try twice:
          1. Normal call (only available transitions) — succeeds when the service account satisfies
             the workflow condition.
          2. Force fallback using includeUnavailableTransitions=true — surfaces the transition even
             when the condition marks it unavailable, then attempts the POST directly.  If Jira
             still rejects it (hard condition), we return a clear actionable error pointing to the
             Jira workflow fix.
        """
        def _find_approved(transitions: list[dict]) -> dict | None:
            for t in transitions:
                if t.get("name", "").lower() == self.APPROVED_STATUS.lower():
                    return t
                if t.get("to", {}).get("name", "").lower() == self.APPROVED_STATUS.lower():
                    return t
            return None

        try:
            # --- Attempt 1: normal (only transitions the service account can execute) ---
            transitions = self.get_transitions(ticket_key)
            approved_transition = _find_approved(transitions)

            if approved_transition:
                payload = {"transition": {"id": approved_transition["id"]}}
                self._make_request("POST", f"issue/{ticket_key}/transitions", json=payload)
                print(f"[NoMAD] Transitioned {ticket_key} to Approved status")
                return {"success": True}

            available_names = [t.get("name", "Unknown") for t in transitions]
            print(f"[NoMAD] {ticket_key}: 'Approved' not in available transitions {available_names}. "
                  f"Retrying with includeUnavailableTransitions...")

            # --- Attempt 2: force fallback ---
            all_transitions = self.get_transitions(ticket_key, include_unavailable=True)
            approved_transition = _find_approved(all_transitions)

            if not approved_transition:
                all_names = [t.get("name", "Unknown") for t in all_transitions]
                error_msg = (
                    f"No 'Approved' transition found for {ticket_key} even with includeUnavailableTransitions. "
                    f"All transitions: {all_names}. Check that the PRES workflow has a transition leading to "
                    f"'Approved' status."
                )
                print(f"[NoMAD] {ticket_key}: {error_msg}")
                return {"success": False, "error": error_msg}

            try:
                payload = {"transition": {"id": approved_transition["id"]}}
                self._make_request("POST", f"issue/{ticket_key}/transitions", json=payload)
                print(f"[NoMAD] Transitioned {ticket_key} to Approved status (via force fallback)")
                return {"success": True}
            except Exception as post_err:
                error_msg = (
                    f"Failed to approve {ticket_key}: the 'Approve' transition exists but is blocked "
                    f"by a Jira workflow condition for the NoMAD App service account. "
                    f"A Jira admin must open PRES project settings -> Workflows -> edit the workflow -> "
                    f"'Approve' transition -> Conditions, and allow the NoMAD App principal. "
                    f"(Raw error: {post_err})"
                )
                print(f"[NoMAD] {ticket_key}: {error_msg}")
                return {"success": False, "error": error_msg}

        except Exception as e:
            print(f"Error transitioning {ticket_key} to Approved: {e}")
            return {"success": False, "error": str(e)}

    def get_full_ticket_data(self, ticket_key: str) -> Optional[dict]:
        """Get all field data for a ticket (for copying)"""
        try:
            issue = self._make_request("GET", f"issue/{ticket_key}?expand=renderedFields")
            return issue
        except Exception as e:
            print(f"Error fetching full data for {ticket_key}: {e}")
            return None

    def create_fst_ticket(self, pres_ticket_key: str) -> Optional[str]:
        """
        Create a copy of a PRES ticket on the FST board.
        Returns the new FST ticket key, or None on failure.
        """
        try:
            # Get the source ticket data
            source = self.get_full_ticket_data(pres_ticket_key)
            if not source:
                print(f"[NoMAD] Could not fetch source ticket {pres_ticket_key}")
                return None
            
            fields = source.get("fields", {})
            
            # Get project ID for FST
            fst_project = self._make_request("GET", f"project/{self.FST_PROJECT_KEY}")
            fst_project_id = fst_project.get("id")
            
            if not fst_project_id:
                print(f"[NoMAD] Could not find FST project")
                return None
            
            # Get the default issue type for FST (usually "Task" or similar)
            # We'll try to match the source issue type, or default to Task
            source_issue_type = fields.get("issuetype", {}).get("name", "Task")
            
            # Get available issue types for FST project
            fst_issue_types = fst_project.get("issueTypes", [])
            issue_type_id = None
            
            for it in fst_issue_types:
                if it.get("name") == source_issue_type:
                    issue_type_id = it.get("id")
                    break
            
            # If no match, use the first available (non-subtask) issue type
            if not issue_type_id:
                for it in fst_issue_types:
                    if not it.get("subtask", False):
                        issue_type_id = it.get("id")
                        break
            
            if not issue_type_id:
                print(f"[NoMAD] No suitable issue type found for FST project")
                return None
            
            # Build the new ticket payload
            # Copy key fields from source
            new_fields = {
                "project": {"id": fst_project_id},
                "issuetype": {"id": issue_type_id},
                "summary": fields.get("summary", f"Copy of {pres_ticket_key}"),
            }
            
            # Copy description if present
            if fields.get("description"):
                new_fields["description"] = fields["description"]
            
            # Copy assignee if present
            if fields.get("assignee"):
                new_fields["assignee"] = {"accountId": fields["assignee"].get("accountId")}
            
            # Copy due date if present
            if fields.get("duedate"):
                new_fields["duedate"] = fields["duedate"]
            
            # Copy the Total Count (lines) custom field if it exists on FST
            if fields.get(self.LINES_FIELD):
                new_fields[self.LINES_FIELD] = fields[self.LINES_FIELD]
            
            # Copy Screening Due date if present
            if fields.get(self.SCREENING_DUE_DATE_FIELD):
                new_fields[self.SCREENING_DUE_DATE_FIELD] = fields[self.SCREENING_DUE_DATE_FIELD]
            
            # Copy priority if present
            if fields.get("priority"):
                new_fields["priority"] = {"id": fields["priority"].get("id")}
            
            # Copy labels if present
            if fields.get("labels"):
                new_fields["labels"] = fields["labels"]
            
            # Create the ticket
            payload = {"fields": new_fields}
            result = self._make_request("POST", "issue", json=payload)
            
            new_key = result.get("key")
            if new_key:
                print(f"[NoMAD] Created FST ticket {new_key} as copy of {pres_ticket_key}")
                return new_key
            else:
                print(f"[NoMAD] Failed to create FST ticket - no key returned")
                return None
                
        except Exception as e:
            print(f"Error creating FST ticket for {pres_ticket_key}: {e}")
            import traceback
            traceback.print_exc()
            return None

    def get_available_link_types(self) -> list:
        """Get all available issue link types in this Jira instance"""
        try:
            response = self._make_request("GET", "issueLinkType")
            link_types = response.get("issueLinkTypes", [])
            print(f"[NoMAD] Available link types: {[lt.get('name') for lt in link_types]}")
            return link_types
        except Exception as e:
            print(f"[NoMAD] Error getting link types: {e}")
            return []

    def link_tickets(self, from_key: str, to_key: str, link_type: str = None) -> bool:
        """
        Create a link between two tickets.
        If link_type is None, will try common types in order: Relates, Cloners, Clones, Blocks
        """
        # Try multiple link type names since different Jira instances have different ones
        link_types_to_try = [link_type] if link_type else ["Relates", "Cloners", "Clones", "relates to", "Blocks"]
        
        for lt in link_types_to_try:
            if not lt:
                continue
            try:
                payload = {
                    "type": {"name": lt},
                    "inwardIssue": {"key": from_key},
                    "outwardIssue": {"key": to_key}
                }
                print(f"[NoMAD] Attempting to link {from_key} -> {to_key} with type '{lt}'...")
                self._make_request("POST", "issueLink", json=payload)
                print(f"[NoMAD] ✓ Successfully linked {from_key} -> {to_key} ({lt})")
                return True
            except Exception as e:
                error_str = str(e)
                print(f"[NoMAD] Link failed with type '{lt}': {error_str}")
                # If it's not a "link type not found" error, don't try other types
                if "No issue link type" not in error_str and "link type" not in error_str.lower():
                    break
                continue
        
        # If all attempts failed, log available types for debugging
        print(f"[NoMAD] All link attempts failed. Fetching available link types...")
        self.get_available_link_types()
        return False

    def process_jumped_ticket(self, ticket_key: str) -> dict:
        """
        Full "Jump" workflow for an approved ticket whose week has started:
        1. Transition PRES ticket to "Jumped" status
        2. Create a copy on FST board
        3. Link the FST ticket back to the PRES ticket
        
        Returns: {"success": bool, "fst_key": str|None, "error": str|None}
        """
        result = {"success": False, "fst_key": None, "error": None}
        
        try:
            # Step 1: Create FST copy first (before transition, in case it fails)
            fst_key = self.create_fst_ticket(ticket_key)
            if not fst_key:
                result["error"] = "Failed to create FST ticket"
                return result
            
            result["fst_key"] = fst_key
            
            # Step 2: Link the tickets (FST relates to PRES)
            link_success = self.link_tickets(fst_key, ticket_key)  # Will try multiple link types
            if not link_success:
                print(f"[NoMAD] Warning: Failed to link {fst_key} to {ticket_key}, continuing...")
            
            # Step 3: Transition PRES ticket to Jumped
            transition_success = self.transition_to_jumped(ticket_key)
            if not transition_success:
                result["error"] = "FST ticket created but failed to transition PRES to Jumped"
                # Don't return failure - FST ticket was created successfully
                print(f"[NoMAD] Warning: Could not transition {ticket_key} to Jumped")
            
            result["success"] = True
            print(f"[NoMAD] Successfully jumped {ticket_key} -> {fst_key}")
            return result
            
        except Exception as e:
            result["error"] = str(e)
            print(f"Error in jump workflow for {ticket_key}: {e}")
            return result

    def is_jumped(self, status: str) -> bool:
        """Check if ticket status is 'Jumped'"""
        return status.lower() == self.JUMPED_STATUS.lower()
