---
name: auto-publish-to-github
description: >-
  Publishes finalized code to the pw-nomad-app GitHub repository
  (https://github.com/yoram-besteman-prewave/pw-nomad-app) by committing the
  changes, pushing a branch, opening a pull request, and merging that pull
  request. Use right after code is finalized or published, for example when the
  user says the code is done/finalized/final/ready/ship it/publish/release, or
  when a feature or bug fix is complete and verified.
---

# Auto-Publish Finalized Code to GitHub

Whenever new code is published here in a finalized state, deploy it to
https://github.com/yoram-besteman-prewave/pw-nomad-app by opening and merging a
GitHub pull request.

## When to trigger

Run this workflow as soon as ANY of these is true:

- The user says the code is finalized, done, final, ready, "ship it", publish, or release.
- A feature or bug fix has just been completed and verified working.

Do NOT trigger for work-in-progress, experiments, or partial/unverified edits.

## Workflow

```
- [ ] 1. Confirm the code is finalized (see triggers above)
- [ ] 2. Check for secrets before publishing
- [ ] 3. Stage all changes
- [ ] 4. Commit with a descriptive message
- [ ] 5. Ensure the GitHub remote is configured
- [ ] 6. Push a publish branch
- [ ] 7. Open a pull request
- [ ] 8. Merge the pull request
```

### Step 2: Check for secrets

This target repo is public. Before publishing, inspect the finalized diff for
secrets such as credentials, API keys, `.env` files, or hardcoded tokens. If
secrets would be published, warn the user and do not publish them unless the
user explicitly confirms.

### Steps 3-4: Stage and commit

```bash
cd <repo root>
git add -A
```

Write a concise message summarizing the finalized change (focus on the "why").
Use a HEREDOC so formatting is preserved:

```bash
git commit -m "$(cat <<'EOF'
<summary of the finalized change>
EOF
)"
```

### Step 5: Ensure the remote exists

The remote may not be configured yet. Point `origin` at the target repo,
adding it only if missing:

```bash
git remote get-url origin 2>/dev/null \
  || git remote add origin https://github.com/yoram-besteman-prewave/pw-nomad-app.git
```

### Step 6: Push a publish branch

```bash
git switch -c publish/<short-description>
git push -u origin HEAD
```

### Step 7: Open a pull request

Use `gh` for GitHub operations:

```bash
gh pr create --title "<PR title>" --body "$(cat <<'EOF'
## Summary
- <what changed>

## Test plan
- <verification performed>

EOF
)"
```

### Step 8: Merge the pull request

Merge the PR after it is created:

```bash
gh pr merge --merge --delete-branch
```

## Notes

- Authenticate to GitHub via the user's existing credentials/SSH. If the push is
  rejected for auth reasons, surface the error instead of changing git config.
- Do not bypass branch protection, force push, skip hooks, or merge checks unless
  the user explicitly asks for that exact override.
