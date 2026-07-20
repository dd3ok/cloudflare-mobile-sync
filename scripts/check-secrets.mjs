import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
})
  .split(/\r?\n/u)
  .filter(Boolean)
  .filter((file) => file !== "pnpm-lock.yaml");

const suspicious = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\bAIza[0-9A-Za-z_-]{30,}\b/u,
  /\bgh[opusr]_[0-9A-Za-z]{30,}\b/u,
  /\b(?:sk_live|rk_live)_[0-9A-Za-z]{16,}\b/u,
  /\bCLOUDFLARE_API_TOKEN\s*=\s*(?!placeholder\b|$)\S+/iu,
];

const findings = [];
for (const file of files) {
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  if (suspicious.some((pattern) => pattern.test(content))) {
    findings.push(file);
  }
}

if (findings.length > 0) {
  console.error(`Potential secret pattern found in ${findings.length} file(s):`);
  for (const file of findings) console.error(`- ${file}`);
  process.exitCode = 1;
} else {
  console.log(`Secret pattern check passed (${files.length} files scanned).`);
}
