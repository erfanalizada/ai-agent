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

      // 3. Read the target file, send content to Claude, write fixed version back
      const targetPath = path.join(WORKDIR, file);
      const originalContent = fs.readFileSync(targetPath, "utf-8");

      const prompt = `You are a senior frontend developer. Here is the contents of the file "${file}":

\`\`\`
${originalContent}
\`\`\`

REPORTED ISSUE: ${issue}
EXPECTED BEHAVIOR: ${expected}

Output ONLY the complete fixed file content. No explanations, no markdown fences, no commentary. Just the raw file content ready to be saved.`;

      // 4. Run Claude Code in print mode to get the fixed file
      job.status = "running_claude";
      job.step = "running_claude";
      console.log(`[job:${jobId}] running_claude`);

      const promptPath = "/tmp/claude-prompt.txt";
      fs.writeFileSync(promptPath, prompt);

      // chown so non-root user can access the cloned repo
      execSync(`chown -R claudeuser:claudeuser ${WORKDIR}`, { shell: "/bin/bash" });
      execSync(`chown claudeuser:claudeuser ${promptPath}`, { shell: "/bin/bash" });

      const fixedContent = execSync(
        `su -p -s /bin/bash claudeuser -c "cat ${promptPath} | claude -p --dangerously-skip-permissions" 2>&1`,
        {
          cwd: WORKDIR,
          env: process.env,
          shell: "/bin/bash",
          timeout: 120000
        }
      ).toString().trim();

      console.log(`[job:${jobId}] claude output length:`, fixedContent.length);
      console.log(`[job:${jobId}] claude output preview:`, fixedContent.substring(0, 200));

      // 5. Write the fixed content back and verify a change was made
      if (fixedContent === originalContent.trim()) {
        throw new Error("Claude returned identical content. No fix was applied.");
      }
      fs.writeFileSync(targetPath, fixedContent);

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

