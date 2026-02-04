import express from "express";
import simpleGit from "simple-git";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import cors from "cors";
import crypto from "crypto";

const app = express();
app.use(cors({ origin: /\.vercel\.app$/ }));
app.use(express.json());

// In-memory job tracking
const jobs = new Map();

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
app.post("/report", (req, res) => {
  const { issue, expected, file } = req.body;

  if (!issue || !expected || !file) {
    return res.status(400).json({
      error: "Missing required fields: issue, expected, file"
    });
  }

  const jobId = crypto.randomUUID();
  const job = { id: jobId, status: "received", step: "received", error: null };
  jobs.set(jobId, job);
  console.log(`[job:${jobId}] received`);

  res.status(202).json({ jobId });

  // Run pipeline asynchronously
  (async () => {
    try {
      // 1. Clean workspace
      job.status = "cloning";
      job.step = "cloning";
      console.log(`[job:${jobId}] cloning`);
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
      job.status = "running_claude";
      job.step = "running_claude";
      console.log(`[job:${jobId}] running_claude`);
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
      job.status = "committing";
      job.step = "committing";
      console.log(`[job:${jobId}] committing`);
      await git.add(".");
      await git.commit("AI fix: reported frontend issue");

      job.status = "pushing";
      job.step = "pushing";
      console.log(`[job:${jobId}] pushing`);
      await git.push("origin", "main");

      job.status = "completed";
      job.step = "completed";
      console.log(`[job:${jobId}] completed`);
    } catch (err) {
      console.error(`[job:${jobId}] failed:`, err);
      job.status = "failed";
      job.step = "failed";
      job.error = err.toString();
    }
  })();
});

app.get("/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }
  res.json(job);
});

app.listen(3000, () => {
  console.log("AI Agent listening on port 3000");
});

