# ai-skills

A collection of reusable skills for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Each skill is a self-contained directory that teaches Claude a repeatable workflow via a slash command.

## Available Skills

| Skill | Description |
|---|---|
| [`implement-pr-suggestions`](#implement-pr-suggestions) | Fetches approved PR review suggestions and implements them in parallel |

## implement-pr-suggestions

Automates the process of implementing PR review suggestions that you have approved. Instead of manually applying each reviewer comment, this skill handles the full cycle: fetch, filter, plan, and apply.

### How it works

1. **Resolve PR** -- determines the PR number from the argument you pass or from the current branch.
2. **Fetch review threads** -- runs a GraphQL query via `gh api graphql` to pull all review threads with comments, diff hunks, and reactions.
3. **Filter to approved threads** -- a TypeScript script discards resolved threads and keeps only those where you (the current `gh` user) have left a thumbs-up reaction on any comment.
4. **Bucket into parallel groups** -- groups suggestions by file and logical dependency (e.g. a route handler and its test go in the same bucket) so independent changes can be applied concurrently.
5. **Spawn subagents** -- launches one Claude Code subagent per bucket in parallel. Each subagent reads the target files, applies the suggestions, and runs `npm run lint` / `npm run typecheck` to verify.

### Approval mechanism

The skill only implements suggestions you have explicitly approved. To approve a review comment, add a thumbs-up reaction to it on GitHub. Threads without your thumbs-up are skipped entirely.

### Prerequisites

- **`gh` CLI** -- installed and authenticated (`gh auth status` should succeed)
- **Node.js** -- required for `npx tsx` which runs the filter script
- **Target project** -- must have `npm run lint` and `npm run typecheck` scripts defined (used for verification after applying changes)

### Usage

```
/implement-pr-suggestions [PR_NUMBER]
```

If `PR_NUMBER` is omitted, the skill attempts to detect the PR associated with the current branch.

### Helper scripts

The `scripts/` directory contains:

- `pr-review-query.graphql` -- GraphQL query for fetching review threads from a PR
- `filter-approved-threads.ts` -- CLI script that filters raw GraphQL output down to approved-only threads

## Installation

Clone (or fork) this repo and point Claude Code at the skill directory. See the [Claude Code custom skills documentation](https://docs.anthropic.com/en/docs/claude-code/skills) for instructions on adding skills from a local path or remote repository.

## License

MIT
