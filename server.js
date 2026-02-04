import express from "express";
import simpleGit from "simple-git";
import { execSync } from "child_process";
import fs from "fs";

const app = express();
app.use(express.json());

const WORKDIR = "/tmp/client-demo";

// GitHub repo (PAT via Railway env var)
const CLIENT_REPO_URL =
  "https://erfanalizada:${process.env.GITHUB_TOKEN}@github.com/erfanalizada/client-demo.git";

/**
 * TEMP: Test Claude 4.5 (Sonnet)
 * Remove after verification
 */
app.get("/test-claude", (req, res) => {
  try {
    const output = execSync(
      `claude chat --model claude-3-5-sonnet-latest --prompt "Say: Claude Sonnet 4.5 works"`,
      {
        env: process.env,
        shell: "/bin/bash"
      }
    ).toString();

    res.status(200).send(output);
  } catch (err) {
    console.error(err);
    res.status(500).send(err.toString());
  }
});

/**
 * MAIN AI AGENT ENDPOINT
 */
app.post("/report", async (req, res) => {
  const { issue, expected, file } = req.body;

  try {
    // Clean workspace
    if (fs.existsSync(WORKDIR)) {
      fs.rmSync(WORKDIR, { recursive: true, force: true });
    }

    // Clone repo
    await simpleGit().clone(CLIENT_REPO_URL, WORKDIR);
    const git = simpleGit(WORKDIR);

    // Claude prompt
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

    // Run Claude Sonnet 4.5
    execSync(
      `cd ${WORKDIR} && claude chat --model claude-3-5-sonnet-latest --prompt "$(cat prompt.txt)"`,
      {
        env: process.env,
        shell: "/bin/bash",
        stdio: "inherit"
      }
    );

    // Commit & push
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
