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

      // 3. Build the prompt (passed via stdin, no file written to repo)
      const prompt = [
        `You are a senior frontend developer. You are working in a git repository at ${WORKDIR}.`,
        ``,
        `STEP 1: Read the file "${file}" using your Read tool to understand the current code.`,
        `STEP 2: Identify the bug described below in that file.`,
        `STEP 3: Use your Edit tool to fix "${file}" directly on disk. Do NOT create new files. Do NOT edit any other file.`,
        ``,
        `REPORTED ISSUE: ${issue}`,
        `EXPECTED BEHAVIOR: ${expected}`,
        `TARGET FILE: ${WORKDIR}/${file}`,
        ``,
        `IMPORTANT: Only modify "${file}". Do not create or edit any other files.`,
      ].join("\n");

      // 4. Run Claude Code (repo-aware edit)
      job.status = "running_claude";
      job.step = "running_claude";
      console.log(`[job:${jobId}] running_claude`);
      console.log(`[job:${jobId}] prompt:`, prompt);
      // chown so non-root user can access the cloned repo
      execSync(`chown -R claudeuser:claudeuser ${WORKDIR}`, { shell: "/bin/bash" });

      // Write prompt to a temp file outside the repo so Claude doesn't see it
      const promptPath = "/tmp/claude-prompt.txt";
      fs.writeFileSync(promptPath, prompt);
      execSync(`chown claudeuser:claudeuser ${promptPath}`, { shell: "/bin/bash" });

      const claudeOutput = execSync(
        `su -p -s /bin/bash claudeuser -c "cat ${promptPath} | claude -p --dangerously-skip-permissions" 2>&1`,
        {
          cwd: WORKDIR,
          env: process.env,
          shell: "/bin/bash",
          timeout: 120000
        }
      ).toString();
      console.log(`[job:${jobId}] claude output:`, claudeOutput);

      // 5. Check if files were actually changed
      const diff = await simpleGit(WORKDIR).diff();
      console.log(`[job:${jobId}] git diff:`, diff || "(no changes)");
      if (!diff) {
        throw new Error("Claude did not modify any files. The fix was not applied.");
      }

      // 6. Commit & push changes
      job.status = "committing";
      job.step = "committing";
      console.log(`[job:${jobId}] committing`);
      await simpleGit(WORKDIR).add(".");
      await simpleGit(WORKDIR).commit("AI fix: reported frontend issue");

      job.status = "pushing";
      job.step = "pushing";
      console.log(`[job:${jobId}] pushing`);
      await git.push("origin", "main");

      job.status = "completed";
      job.step = "completed";
      console.log(`[job:${jobId}] completed`);
    } catch (err) {
      const stderr = err.stderr ? err.stderr.toString() : "";
      const stdout = err.stdout ? err.stdout.toString() : "";
      console.error(`[job:${jobId}] failed:`, err.message, "\nstderr:", stderr, "\nstdout:", stdout);
      job.status = "failed";
      job.step = "failed";
      job.error = stderr || stdout || err.message;
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

