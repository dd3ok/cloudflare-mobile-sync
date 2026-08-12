import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import Ajv from "ajv";
import { parse } from "jsonc-parser";

const SECRET_PLACEHOLDER_PATTERN = /(?:^|:)(?:replace|change)[-_ ]?(?:with|me)(?:[-_ ]|$)/iu;

async function main() {
  const { values } = parseArgs({
    options: {
      config: { type: "string" },
      requirements: { type: "string" },
      "secrets-source": { type: "string", default: "remote" },
      "wrangler-script": { type: "string" },
    },
  });

  if (!values.config) {
    throw new Error("--config is required");
  }

  const configPath = resolve(values.config);
  const parseErrors = [];
  const config = parse(await readFile(configPath, "utf8"), parseErrors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (parseErrors.length > 0 || typeof config !== "object" || config === null) {
    throw new Error("Wrangler config is not valid JSONC");
  }
  if (typeof config.$schema !== "string" || config.$schema.length === 0) {
    throw new Error("Wrangler $schema path is required");
  }
  const schemaPath = resolve(dirname(configPath), config.$schema);
  try {
    await access(schemaPath);
  } catch {
    throw new Error("Wrangler $schema path does not exist");
  }
  const installedWranglerSchemaPath = resolve(
    dirname(configPath),
    "node_modules/wrangler/config-schema.json",
  );
  if (schemaPath !== installedWranglerSchemaPath) {
    throw new Error("Wrangler $schema must reference the installed Wrangler schema");
  }
  if (Object.hasOwn(config, "secrets")) {
    throw new Error(
      "Wrangler config must not declare secret requirements; use required-secrets.json",
    );
  }
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const validateConfig = new Ajv({
    allErrors: true,
    strict: false,
    validateFormats: false,
  }).compile(schema);
  if (!validateConfig(config)) {
    const firstError = validateConfig.errors?.[0];
    const location = firstError?.instancePath || "/";
    const detail = firstError?.message ?? "unknown schema violation";
    throw new Error(`Wrangler config schema validation failed at ${location}: ${detail}`);
  }
  const requirementsPath = resolve(
    values.requirements ?? resolve(dirname(configPath), "required-secrets.json"),
  );
  const requirements = JSON.parse(await readFile(requirementsPath, "utf8"));
  const expectedSecretNames = requirements.deployments?.[basename(configPath)];
  if (!Array.isArray(expectedSecretNames) || expectedSecretNames.length === 0) {
    throw new Error(`No secret requirements found for ${basename(configPath)}`);
  }
  if (
    expectedSecretNames.some(
      (name) => typeof name !== "string" || !/^[A-Z][A-Z0-9_]*$/u.test(name),
    ) ||
    new Set(expectedSecretNames).size !== expectedSecretNames.length
  ) {
    throw new Error("Secret requirements must contain unique environment binding names");
  }

  let availableSecretNames;
  if (values["secrets-source"] === "environment") {
    availableSecretNames = expectedSecretNames.filter((name) => Boolean(process.env[name]));
    const placeholderSecretNames = availableSecretNames.filter((name) =>
      SECRET_PLACEHOLDER_PATTERN.test(process.env[name]),
    );
    if (placeholderSecretNames.length > 0) {
      throw new Error(
        `Required secret names still use placeholder values: ${placeholderSecretNames.join(", ")}`,
      );
    }
  } else if (values["secrets-source"] === "remote") {
    const wranglerScript = resolve(
      values["wrangler-script"] ??
        resolve(dirname(configPath), "node_modules/wrangler/bin/wrangler.js"),
    );
    let listedSecrets;
    try {
      const output = execFileSync(
        process.execPath,
        [wranglerScript, "secret", "list", "--config", configPath, "--format", "json"],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 30_000,
          windowsHide: true,
        },
      );
      listedSecrets = JSON.parse(output);
    } catch {
      throw new Error("Unable to list remote secret names with Wrangler");
    }
    if (!Array.isArray(listedSecrets)) {
      throw new Error("Wrangler secret list did not return a JSON array");
    }
    availableSecretNames = listedSecrets
      .map((entry) => (typeof entry === "object" && entry !== null ? entry.name : undefined))
      .filter((name) => typeof name === "string");
  } else {
    throw new Error(`Unsupported secret source: ${values["secrets-source"]}`);
  }

  const missingSecretNames = expectedSecretNames.filter(
    (name) => !availableSecretNames.includes(name),
  );
  if (missingSecretNames.length > 0) {
    throw new Error(`Missing required secret names: ${missingSecretNames.join(", ")}`);
  }

  console.log(
    `Preflight passed: ${expectedSecretNames.length} required secret names are available.`,
  );
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown preflight error";
  console.error(`Preflight failed: ${message}`);
  process.exitCode = 1;
}
