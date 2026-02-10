---
name: 'implement-pr-suggestions'
description: 'Implement approved PR review suggestions'
allowed-tools: Read, Grep, gh
category: 'github'
---

# Implement PR Suggestions

This skill fetches unresolved PR review conversations, filters to only those approved (👍) by the current user, groups them into dependency-aware buckets, and spawns parallel subagents to implement the changes.

## Step 1 - Resolve PR Number

Determine the PR number to work with:

1. If the skill was invoked with an argument (e.g. `/implement-pr-suggestions 123`), use that as the PR number.
2. Otherwise, try to detect the PR for the current branch:
   ```bash
   gh pr view --json number -q '.number'
   ```
3. If neither works, stop and ask the user to provide a PR number.

Also resolve the current GitHub username:
```bash
gh api user -q '.login'
```

Store both `PR_NUMBER` and `GITHUB_USERNAME` for subsequent steps.

Also resolve the skill directory — the absolute path provided in the "Base directory for this skill" context when this skill is loaded. Store it as `SKILL_DIR`. All script references below use this variable so the skill works regardless of where it is installed.

## Step 2 - Fetch Review Threads

Use `gh api graphql` with the query file at `{SKILL_DIR}/scripts/pr-review-query.graphql` to fetch all review threads with full comment and reaction data.

To get OWNER and REPO, run:
```bash
gh repo view --json owner,name -q '.owner.login + " " + .name'
```

All temporary and output files are stored under `auto-pr-reviews/` in the project root. Construct the branch-safe name by replacing `/` with `-` in the branch name (e.g. `feature/ENG-5753` becomes `feature-ENG-5753`).

Then fetch the threads using the GraphQL file:
```bash
mkdir -p auto-pr-reviews
gh api graphql -F owner='{OWNER}' -F repo='{REPO}' -F pr={PR_NUMBER} -f query="$(cat {SKILL_DIR}/scripts/pr-review-query.graphql)" > auto-pr-reviews/{BRANCH_SAFE}-{PR_NUMBER}-raw-threads.json
```

## Step 3 - Filter Approved Threads

Run the standalone TypeScript filter script. It discards resolved threads and keeps only those the current user has approved with a 👍 reaction, writing the result to a JSON file:

```bash
npx tsx {SKILL_DIR}/scripts/filter-approved-threads.ts \
  auto-pr-reviews/{BRANCH_SAFE}-{PR_NUMBER}-raw-threads.json \
  "$GITHUB_USERNAME" \
  auto-pr-reviews/{BRANCH_SAFE}-{PR_NUMBER}-approved-threads.json
```

The script handles all filtering in one pass:
1. Discards threads where `isResolved == true`
2. Of the remaining unresolved threads, keeps only those where ANY comment has a `THUMBS_UP` reaction from the specified GitHub user
3. Writes the result to `auto-pr-reviews/{BRANCH_SAFE}-{PR_NUMBER}-approved-threads.json`

Read the output file. If the result is an empty array `[]`, inform the user that no approved suggestions were found and stop.

## Step 4 - Bucket and Write Plan JSON

Analyze the filtered (approved) suggestions and group them into **parallel buckets** using dependency-aware logic.

### Bucketing Rules

1. **Same-file rule**: Suggestions targeting the same file MUST be in the same bucket (sequential application avoids merge conflicts).

2. **Cross-file dependency rule**: Suggestions that are logically coupled across files MUST also be in the same bucket. Examples:
   - A route handler change + its corresponding test file change
   - A service method change + the controller that calls it
   - A model change + migrations or service updates that depend on it
   - Import/export changes that affect consuming files
   - Shared type/interface changes + files that use those types

3. **Parallel buckets**: Only suggestions with NO logical dependency on each other go into separate parallel buckets (e.g., two unrelated bug fixes in completely independent modules).

### Output Format

Write the plan JSON to:
```
auto-pr-reviews/{branch-name}-{pr-number}.json
```

Use the same branch-safe name from earlier steps (replacing `/` with `-`).

The JSON schema:
```json
{
  "version": "2.0",
  "prNumber": 123,
  "branch": "feature/my-branch",
  "createdAt": "2026-02-10T10:30:00Z",
  "githubUsername": "octocat",
  "approvedThreads": [ ... ],
  "buckets": [
    {
      "id": 1,
      "rationale": "Route handler and its test file are logically coupled",
      "files": ["pages/api/v3.0/users/index.ts", "__tests__/pages/api/v3.0/users/index.test.ts"],
      "threads": [ ... ]
    },
    {
      "id": 2,
      "rationale": "Independent utility change with no cross-file dependencies",
      "files": ["helpers/formatDate.ts"],
      "threads": [ ... ]
    }
  ],
  "summary": {
    "totalApprovedThreads": 5,
    "totalBuckets": 2,
    "totalFiles": 3
  }
}
```

### Rationale

For each bucket, include a `rationale` string explaining WHY these suggestions were grouped together. This helps with auditability and debugging.

## Step 5 - Spawn Parallel Subagents

For each bucket in the plan, spin up a coder subagent (choose among the available ones) via the **Task** tool. All buckets run in **parallel** (launch them in a single message with multiple Task tool calls).

### Subagent Prompt Template

Each subagent receives:

```
You are implementing approved PR review suggestions for PR #{PR_NUMBER}.

## Your Bucket (Bucket {BUCKET_ID})
Rationale: {RATIONALE}

## Files to Modify
{LIST_OF_FILES}

## Suggestions to Implement
{For each thread in the bucket, include:}
- File: {path}
- Line: {line} (original: {originalLine}, side: {diffSide})
- Diff context:
```
{diffHunk from the first comment}
```
- Suggestion:
{comment body}
- Author: {author.login}

## Instructions
1. Read each file before modifying it.
2. Apply each suggestion carefully, using the diff hunk as context to locate the correct position.
3. If a suggestion contains a ```suggestion code block, apply that exact code change.
4. If a suggestion is descriptive (no code block), implement the described change using your best judgment.
5. After applying ALL suggestions in this bucket, run verification:
   - `npm run lint` (fix any lint errors you introduced)
   - `npm run typecheck` (fix any type errors you introduced)
6. Do NOT commit changes. Just apply and verify.
```

### Final Verification

After ALL subagents complete, run a final verification pass across the entire codebase:

```bash
npm run lint
npm run typecheck
```

If there are errors, fix them. Then report to the user:
- How many suggestions were implemented
- Which files were modified
- Whether verification passed
- Any suggestions that could not be applied (with reasons)

## Additional resources

All helper scripts live in `{SKILL_DIR}/scripts/`:

- **`scripts/pr-review-query.graphql`** — GraphQL query that fetches review threads with comments, reactions, and diff hunks from a PR. Used in Step 2.
- **`scripts/filter-approved-threads.ts`** — TypeScript CLI script that reads raw GraphQL output, discards resolved threads, keeps only those with a thumbs-up from the specified user, and writes the filtered result to a JSON file. Used in Step 3.
- **`EXAMPLE.json`** — Reference example of the plan JSON output schema produced in Step 4.
