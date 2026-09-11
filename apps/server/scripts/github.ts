// Try the GitHub integration by hand against the repository in .env.
// Run from the repository root: pnpm github <command>
import { loadConfig } from "../src/config.ts";
import { createHttpGitHubClient } from "../src/github/http-client.ts";
import { createRepositoryService } from "../src/services/repository.ts";

const USAGE = `Usage: pnpm github <command>

  status                       check access and show the base branch head
  ls [ref]                     list files (default: base branch)
  cat <path> [ref]             print a file (default: base branch)
  save <branch> <path> <text>  commit <text> to <path> on a cms/ branch and open or update its PR
  pr <number>                  show a pull request`;

async function main(args: string[]): Promise<void> {
  const config = loadConfig(process.env);
  const repository = createRepositoryService({
    github: createHttpGitHubClient(config.github),
    baseBranch: config.github.baseBranch,
  });
  const [command, ...rest] = args;

  switch (command) {
    case "status": {
      const access = await repository.verifyAccess();
      console.log(`Connected to ${access.fullName}`);
      console.log(`Base branch ${access.baseBranch} is at ${access.headSha}`);
      return;
    }
    case "ls": {
      const files = await repository.listFiles(rest[0]);
      console.log(files.join("\n"));
      return;
    }
    case "cat": {
      const [path, ref] = rest;
      if (!path) break;
      const content = await repository.readFile(path, ref);
      console.log(content ?? `No file at ${path}`);
      return;
    }
    case "save": {
      const [branch, path, text] = rest;
      if (!branch || !path || text === undefined) break;
      const result = await repository.saveToBranch({
        branch,
        message: `Update ${path}`,
        changes: [{ path, content: `${text}\n` }],
        pullRequest: { title: `Update ${path}`, body: "Test from Astro CMS." },
      });
      console.log(
        `${result.createdBranch ? "Created" : "Updated"} branch ${branch}`,
      );
      console.log(`Commit ${result.commitSha}`);
      console.log(
        `${result.createdPullRequest ? "Opened" : "Updated"} PR #${result.pullRequest.number}: ${result.pullRequest.url}`,
      );
      return;
    }
    case "pr": {
      const pr = await repository.getPullRequest(Number(rest[0]));
      console.log(
        pr ? JSON.stringify(pr, null, 2) : `No pull request #${rest[0]}`,
      );
      return;
    }
  }
  console.log(USAGE);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
