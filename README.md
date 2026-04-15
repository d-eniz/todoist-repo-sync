# todoist-repo-sync

A reusable GitHub Action that creates Todoist tasks from GitHub issues and pull requests.

It is built for two common cases:

- live sync when an issue or pull request is opened, reopened, or assigned
- scheduled or manual backfill of everything currently open in a repository

The action is safe to run on both event-driven and scheduled workflows because it adds a stable GitHub source marker to the Todoist task description and skips duplicates when that marker already exists in the target Todoist project.

## What it does

For each matching GitHub issue or pull request, the action creates a Todoist task like this:

- content: `[owner/repo] Issue #123: Fix login redirect`
- description:

```text
https://github.com/owner/repo/issues/123

Source: github://owner/repo/issue/123
```

For pull requests, the task content uses `PR` instead of `Issue`.

## Quick start

Create a workflow in the repository you want to sync:

```yaml
name: Sync GitHub to Todoist

on:
  issues:
    types: [opened, reopened, assigned]
  pull_request:
    types: [opened, reopened, assigned]
  schedule:
    - cron: "0 3 * * *"
  workflow_dispatch:

jobs:
  sync:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: read
      pull-requests: read
    steps:
      - name: Create or backfill Todoist tasks
        uses: your-org/todoist-repo-sync@v1
        with:
          todoist-token: ${{ secrets.TODOIST_TOKEN }}
          todoist-project-id: ${{ secrets.TODOIST_PROJECT_ID }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

If you only want live sync for issue or PR events, you can omit `schedule`, `workflow_dispatch`, and `github-token`.

## Inputs

| Input | Required | Default | Notes |
| --- | --- | --- | --- |
| `todoist-token` | yes |  | Todoist API token. |
| `todoist-project-id` | yes |  | Project ID that will receive new tasks. |
| `github-token` | no |  | Required for `backfill` mode and for `auto` mode when the workflow runs on `schedule` or `workflow_dispatch`. |
| `mode` | no | `auto` | `auto`, `event`, or `backfill`. |
| `allowed-actions` | no | `opened,reopened,assigned` | Event actions that should trigger sync in `event` mode. |
| `include-issues` | no | `true` | Set to `false` to ignore issues. |
| `include-pull-requests` | no | `true` | Set to `false` to ignore pull requests. |
| `skip-duplicates` | no | `true` | Skips creation when an active task with the same GitHub source marker is already in the Todoist project. |
| `task-template` | no | `[{{repo}}] {{kind}} #{{number}}: {{title}}` | Template for Todoist task content. |
| `description-template` | no | `{{url}}` | Human-readable part of the Todoist description. The GitHub source marker is appended automatically. |

## Template variables

You can use these placeholders in `task-template` and `description-template`:

- `{{repo}}`
- `{{kind}}`
- `{{number}}`
- `{{title}}`
- `{{url}}`
- `{{state}}`
- `{{author}}`
- `{{assignees}}`

## Outputs

| Output | Description |
| --- | --- |
| `created-count` | Number of Todoist tasks created. |
| `skipped-count` | Number of GitHub items skipped because of filters or duplicates. |
| `processed-count` | Number of GitHub items examined in the run. |
| `created-task-ids` | JSON array of created Todoist task IDs. |

## Permissions and secrets

Recommended repository secrets:

- `TODOIST_TOKEN`
- `TODOIST_PROJECT_ID`

Recommended workflow permissions:

- `contents: read`
- `issues: read`
- `pull-requests: read`

`github-token` can usually be set to `${{ secrets.GITHUB_TOKEN }}`.

## Release and usage

To use this action from other repositories:

1. Push this repository to GitHub.
2. Create a tag such as `v1`.
3. Reference it as `uses: your-org/todoist-repo-sync@v1`.

The action intentionally does not close or complete Todoist tasks when GitHub issues or pull requests are closed. It only creates and backfills tasks.

## Local development

```bash
npm test
```

The checked-in runtime lives in `dist/`, so consumers can use the action without a build step.
