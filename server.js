import express from "express";
import simpleGit from "simple-git";
import { execSync } from "child_process";
import fs from "fs";

const app = express();
app.use(express.json());

const WORKDIR = "/tmp/client-demo";

// GitHub repo (PAT comes from Railway env var)
const CLIENT_REPO_URL =
  "https://erfanalizada:${process.env.GITHUB_TOKEN}@github.com/erfanalizada/client-demo.git";

/**
 * =========================
 * TEMPORARY TEST ENDPOINT
 * =========================
 * Use this ONLY to verify:
 * - Claude CLI exists
 * - ANTHROPIC_API_KEY works
 * Remove this endpoint after testing.
 */
app.get("/test-claude", (req, res) => {
  try {
    const output = execSync(
      'claude <<EOF\nSay "Claude CLI works"\nEOF',
      { env: process.env }
    ).toString();

    res.status(200).send(output);
  } catch (err) {
    console.error(err);
    res.status(500).send(err.toString());
  }
});

/**
 * =========================
 * MAIN AI AGENT ENDPOINT
 * =========================
 * Called by the Vercel frontend
 */
app.post("/report", async (req, res) => {
  const { issue, expected, file } = req.body;

  try {
    // Clean workspace
    if (fs.existsSync(WORKDIR)) {
      fs.rmSync(WORKDIR, { recursive: true, force: true });
    }

    // Clone client repo
    await simpleGit().clone(CLIENT_REPO_URL, WORKDIR);
    const git = simpleGit(WORKDIR);

    // Build Claude prompt
    const prompt = `
You are a senior frontend developer.

Fix the bug in the repository.

Rules:
- Make the smallest possible change
- Do not add dependencies
- Modify only what is required

Issue:
${issue}

Expected behavior:
${expected}

Target file:
${file}

Apply the fix directly in the code.
`;

    fs.writeFileSync(`${WORKDIR}/prompt.txt`, prompt);

    // Run Claude CLI inside the repo
    execSync(`cd ${WORKDIR} && claude < prompt.txt`, {
      stdio: "inherit",
      env: process.env
    });

    // Commit & push changes
    await git.add(".");
    await git.commit("AI fix: alert button not working");
    await git.push("origin", "main");

    res.status(200).json({ status: "success" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.toString() });
  }
});

app.listen(3000, () => {
  console.log("AI Agent listening on port 3000");
});
