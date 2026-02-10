#!/usr/bin/env npx tsx

/**
 * filter-approved-threads.ts
 *
 * Filters PR review threads to only those approved (👍) by a specific GitHub user.
 *
 * Usage:
 *   npx tsx filter-approved-threads.ts <json-file-path> <github-username> <output-file-path>
 *
 * Input:  Raw GraphQL JSON output from `gh api graphql` containing reviewThreads
 * Output: JSON array of approved threads written to the specified output file
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

interface Reaction {
  content: string;
  user: {
    login: string;
  };
}

interface Comment {
  id: string;
  body: string;
  author: {
    login: string;
  };
  createdAt: string;
  diffHunk: string;
  reactions: {
    nodes: Reaction[];
  };
}

interface ReviewThread {
  id: string;
  isResolved: boolean;
  path: string;
  line: number | null;
  originalLine: number | null;
  diffSide: string;
  comments: {
    nodes: Comment[];
  };
}

interface GraphQLResponse {
  data: {
    repository: {
      pullRequest: {
        number: number;
        headRefName: string;
        reviewThreads: {
          nodes: ReviewThread[];
        };
      };
    };
  };
}

interface ApprovedThread {
  id: string;
  path: string;
  line: number | null;
  originalLine: number | null;
  diffSide: string;
  comments: Array<{
    id: string;
    body: string;
    author: string;
    createdAt: string;
    diffHunk: string;
  }>;
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.error(
      "Usage: npx tsx filter-approved-threads.ts <json-file-path> <github-username> <output-file-path>"
    );
    process.exit(1);
  }

  const [jsonFilePath, githubUsername, outputFilePath] = args;

  let rawJson: string;
  try {
    rawJson = readFileSync(jsonFilePath, "utf-8");
  } catch (err) {
    console.error(`Error reading file: ${jsonFilePath}`);
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  let data: GraphQLResponse;
  try {
    data = JSON.parse(rawJson);
  } catch (err) {
    console.error("Error parsing JSON");
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const threads = data.data.repository.pullRequest.reviewThreads.nodes;

  const unresolvedThreads = threads.filter((t) => !t.isResolved);

  const approvedThreads: ApprovedThread[] = unresolvedThreads.filter(
    (thread) => {
      return thread.comments.nodes.some((comment) =>
        comment.reactions.nodes.some(
          (reaction) =>
            reaction.content === "THUMBS_UP" &&
            reaction.user.login === githubUsername
        )
      );
    }
  ).map((thread) => ({
    id: thread.id,
    path: thread.path,
    line: thread.line,
    originalLine: thread.originalLine,
    diffSide: thread.diffSide,
    comments: thread.comments.nodes.map((c) => ({
      id: c.id,
      body: c.body,
      author: c.author.login,
      createdAt: c.createdAt,
      diffHunk: c.diffHunk,
    })),
  }));

  mkdirSync(dirname(outputFilePath), { recursive: true });
  writeFileSync(outputFilePath, JSON.stringify(approvedThreads, null, 2));
  console.log(`Wrote ${approvedThreads.length} approved threads to ${outputFilePath}`);
}

main();
