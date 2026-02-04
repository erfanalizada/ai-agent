import express from "express";
import simpleGit from "simple-git";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const app = express();
app.use(express.json());

const WORKDIR = "/tmp/client-demo";

// GitHub repo (PAT comes from Railway env var)
const CLIENT_REPO_URL =
  "https://erfanalizada:" +
  process.env.GITHUB_TOKEN +
  "@github.com/erfanalizada/client-demo.git";

/**
 * =========================
 * TEMP TEST ENDPOINT
 * =========================
 * Confirms claude is installed and runnable.
 * DELETE after verification.
 */
app.get("/test-claude", (req, res) => {
  try {
    const output = execSync("claude --version", {
      env: process.env,
      shell: "/bin/bash"
    }).toString();

    res.status(200).send(output);
  } catch (err) {
    res.status(500).send(err.toString());
  }
});

/**
 * =========================
 * MAIN AI AGENT ENDPOINT
 * =========================
 */
app.post("/report", async (req, res) => {
  const { issue, expected, file } = req.body;

  if (!issue || !expected || !file) {
    return res.status(400).json({
      error: "Missing required fields: issue, expected, file"
    });
  }

  try {
    // 1. Clean workspace
    if (fs.existsSync(WORKDIR)) {
      fs.rmSync(WORKDIR, { recursive: true, force: true });
    }

    // 2. Clone client repo
    await simpleGit().clone(CLIENT_REPO_URL, WORKDIR);
    const git = simpleGit(WORKDIR);

    // 3. Create Claude Code task file
    const task = `
You are a senior frontend developer.

GOAL:
Fix the reported bug in this repository.

CONSTRAINTS:
- Make the smallest possible change
- Do NOT add dependencies
- Do NOT refactor unrelated code
- Modify ONLY what is required

REPORTED ISSUE:
${issue}

EXPECTED BEHAVIOR:
${expected}

TARGET FILE:
${file}

INSTRUCTIONS:
- Apply the fix directly in the codebase
- Do not explain, just implement
`;

    const taskPath = path.join(WORKDIR, "TASK.md");
    fs.writeFileSync(taskPath, task.trim());

    // 4. Run Claude Code (repo-aware edit)
    execSync(
      `
      cd ${WORKDIR}
      claude apply TASK.md
      `,
      {
        env: process.env,
        shell: "/bin/bash",
        stdio: "inherit"
      }
    );

    // 5. Commit & push changes
    await git.add(".");
    await git.commit("AI fix: reported frontend issue");
    await git.push("origin", "main");

    res.status(200).json({
      status: "success",
      message: "Issue fixed and deployed"
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err.toString()
    });
  }
});

app.listen(3000, () => {
  console.log("AI Agent listening on port 3000");
});

