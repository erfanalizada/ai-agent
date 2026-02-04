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
    const version = execSync("claude --version", {
      env: process.env,
      shell: "/bin/bash"
    }).toString().trim();

    // Test that the API key works by running a simple prompt as claudeuser
    const testOutput = execSync(
      `su -s /bin/bash claudeuser -c "export HOME=/home/claudeuser && export ANTHROPIC_API_KEY='$ANTHROPIC_API_KEY' && export PATH='$PATH' && echo 'Say hi' | claude -p --dangerously-skip-permissions"`,
      {
        env: process.env,
        shell: "/bin/bash",
        timeout: 30000
      }
    ).toString().trim();

    res.status(200).json({ version, apiTest: testOutput });
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

      // 3. Build prompt for Claude to act as a full agent (read, edit files itself)
      const prompt = `Find and fix this bug in the file "${file}" in this project directory. Use your tools to read the file, then edit it directly.

REPORTED ISSUE: ${issue}
EXPECTED BEHAVIOR: ${expected}

Do not create new files. Only edit "${file}".`;

      // 4. Run Claude Code as a full agent
      job.status = "running_claude";
      job.step = "running_claude";
      console.log(`[job:${jobId}] running_claude`);

      // chown so non-root user can access the cloned repo
      execSync(`chown -R claudeuser:claudeuser ${WORKDIR}`, { shell: "/bin/bash" });

      // Write prompt to a unique temp file outside the repo
      const promptPath = `/tmp/claude-prompt-${jobId}.txt`;
      fs.writeFileSync(promptPath, prompt, { mode: 0o644 });

      // Build env string to pass all relevant vars to claudeuser
      const envVars = Object.entries(process.env)
        .filter(([k]) => k.startsWith("ANTHROPIC") || k === "PATH" || k === "NODE_ENV")
        .map(([k, v]) => `export ${k}='${v.replace(/'/g, "'\\''")}'`)
        .join(" && ");

      const claudeCmd = [
        `export HOME=/home/claudeuser`,
        envVars,
        `cd ${WORKDIR}`,
        `claude -p --dangerously-skip-permissions --verbose < ${promptPath}`
      ].filter(Boolean).join(" && ");

      console.log(`[job:${jobId}] running command as claudeuser`);

      const claudeOutput = execSync(
        `su -s /bin/bash claudeuser -c "${claudeCmd.replace(/"/g, '\\"')}"`,
        {
          cwd: WORKDIR,
          env: process.env,
          shell: "/bin/bash",
          timeout: 300000
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

