import express from "express";
import simpleGit from "simple-git";
import { execSync } from "child_process";
import fs from "fs";

const app = express();
app.use(express.json());

const WORKDIR = "/tmp/client-demo";

// IMPORTANT: you will paste your PAT into Railway env vars
const CLIENT_REPO_URL =
  "https://erfanalizada:${process.env.GITHUB_TOKEN}@github.com/erfanalizada/client-demo.git";

app.post("/report", async (req, res) => {
  const { issue, expected, file } = req.body;

  try {
    if (fs.existsSync(WORKDIR)) {
      fs.rmSync(WORKDIR, { recursive: true, force: true });
    }

    await simpleGit().clone(CLIENT_REPO_URL, WORKDIR);
    const git = simpleGit(WORKDIR);

    const prompt = `
You are a senior frontend developer.

Fix the bug in the repository.

Rules:
- Minimal change
- No new dependencies
- Modify only what is required

Issue:
${issue}

Expected:
${expected}

File:
${file}

Apply the fix directly in the code.
`;

    fs.writeFileSync(`${WORKDIR}/prompt.txt`, prompt);

    execSync(`cd ${WORKDIR} && claude < prompt.txt`, {
      stdio: "inherit",
      env: process.env
    });

    await git.add(".");
    await git.commit("AI fix: alert button not working");
    await git.push("origin", "main");

    res.json({ status: "success" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.toString() });
  }
});

app.listen(3000, () => {
  console.log("AI Agent listening on port 3000");
});
