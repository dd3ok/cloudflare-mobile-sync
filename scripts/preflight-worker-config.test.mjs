import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const preflightScript = resolve(repositoryRoot, "scripts/preflight-worker-config.mjs");
const fakeWranglerScript = resolve(
  repositoryRoot,
  "scripts/fixtures/fake-wrangler-secret-list.mjs",
);
const primaryConfig = resolve(repositoryRoot, "apps/worker/wrangler.jsonc");
const antHellConfig = resolve(repositoryRoot, "apps/worker/wrangler.ant-hell.jsonc");

function runPreflight(environment, config = primaryConfig, requirements) {
  const arguments_ = [preflightScript, "--config", config, "--secrets-source", "environment"];
  if (requirements) arguments_.push("--requirements", requirements);
  return spawnSync(process.execPath, arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
}

test("primary preflight requires auth and Google secrets without printing their values", () => {
  const secret = "primary-secret-value-must-stay-private";
  const keyring = "primary-keyring-value-must-stay-private";
  const googleClientId = "primary-google-id-value-must-stay-private";
  const googleClientSecret = "primary-google-secret-value-must-stay-private";

  const result = runPreflight({
    BETTER_AUTH_SECRET: secret,
    BETTER_AUTH_SECRETS: keyring,
    GOOGLE_CLIENT_ID: googleClientId,
    GOOGLE_CLIENT_SECRET: googleClientSecret,
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /4 required secret names are available/u);
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    new RegExp(`${secret}|${keyring}|${googleClientId}|${googleClientSecret}`, "u"),
  );
});

test("preflight validates every committed deployment configuration", () => {
  const secretValues = {
    BETTER_AUTH_SECRET: "ant-hell-primary-secret-value-must-stay-private",
    BETTER_AUTH_SECRETS: "ant-hell-keyring-value-must-stay-private",
    GOOGLE_CLIENT_ID: "ant-hell-google-id-value-must-stay-private",
    GOOGLE_CLIENT_SECRET: "ant-hell-google-secret-value-must-stay-private",
  };

  const result = runPreflight(secretValues, antHellConfig);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /4 required secret names are available/u);
  for (const value of Object.values(secretValues)) {
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(value, "u"));
  }
});

test("committed deployments retain their existing fail-closed origins and collections", async () => {
  const primary = JSON.parse(await readFile(primaryConfig, "utf8"));
  const antHell = JSON.parse(await readFile(antHellConfig, "utf8"));

  assert.equal(primary.vars.ALLOWED_COLLECTIONS, "saved-readings-v1,app-settings-v1");
  assert.equal(
    primary.vars.TRUSTED_ORIGINS,
    "com.byeolsata.app.dev://,com.byeolsata.app.preview://,com.byeolsata.app://",
  );
  assert.equal(antHell.vars.ALLOWED_COLLECTIONS, "");
  assert.equal(antHell.vars.TRUSTED_ORIGINS, "com.dd3ok.anthell://");
  assert.equal(Object.hasOwn(primary, "secrets"), false);
  assert.equal(Object.hasOwn(antHell, "secrets"), false);
});

test("preflight reports only the missing secret names", () => {
  const presentSecret = "present-secret-value-must-stay-private";
  const googleClientId = "present-google-id-value-must-stay-private";
  const googleClientSecret = "present-google-secret-value-must-stay-private";
  const result = runPreflight({
    BETTER_AUTH_SECRET: presentSecret,
    BETTER_AUTH_SECRETS: "",
    GOOGLE_CLIENT_ID: googleClientId,
    GOOGLE_CLIENT_SECRET: googleClientSecret,
  });

  assert.equal(result.status, 1);
  assert.equal(
    result.stderr,
    "Preflight failed: Missing required secret names: BETTER_AUTH_SECRETS\n",
  );
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    new RegExp(`${presentSecret}|${googleClientId}|${googleClientSecret}`, "u"),
  );
});

test("environment preflight rejects example placeholders without printing values", () => {
  const placeholders = {
    BETTER_AUTH_SECRET: "replace-with-32-or-more-random-bytes",
    BETTER_AUTH_SECRETS: "1:replace-with-the-same-random-secret",
    GOOGLE_CLIENT_ID: "replace-with-google-client-id",
    GOOGLE_CLIENT_SECRET: "replace-with-google-client-secret",
  };
  const result = runPreflight(placeholders);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /placeholder values: BETTER_AUTH_SECRET/u);
  for (const value of Object.values(placeholders)) {
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(value, "u"));
  }
});

test("preflight rejects an unresolved Wrangler schema path", async () => {
  const fixturePath = resolve(
    repositoryRoot,
    `apps/worker/.preflight-invalid-schema-${process.pid}.jsonc`,
  );
  const config = JSON.parse(await readFile(primaryConfig, "utf8"));
  config.$schema = "./node_modules/wrangler/schema-that-does-not-exist.json";
  await writeFile(fixturePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  try {
    const result = runPreflight(
      {
        BETTER_AUTH_SECRET: "available-primary-secret",
        BETTER_AUTH_SECRETS: "available-primary-keyring",
      },
      fixturePath,
    );

    assert.equal(result.status, 1);
    assert.equal(result.stderr, "Preflight failed: Wrangler $schema path does not exist\n");
  } finally {
    await rm(fixturePath, { force: true });
  }
});

test("preflight rejects a schema path that is not the installed Wrangler schema", async () => {
  const fixturePath = resolve(
    repositoryRoot,
    `apps/worker/.preflight-wrong-schema-${process.pid}.jsonc`,
  );
  const schemaPath = `${fixturePath}.schema.json`;
  const config = JSON.parse(await readFile(primaryConfig, "utf8"));
  config.$schema = `./${schemaPath.split(/[\\/]/u).at(-1)}`;
  await writeFile(fixturePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await writeFile(schemaPath, '{ "type": "object" }\n', "utf8");

  try {
    const result = runPreflight(
      {
        BETTER_AUTH_SECRET: "available-primary-secret",
        BETTER_AUTH_SECRETS: "available-primary-keyring",
      },
      fixturePath,
    );

    assert.equal(result.status, 1);
    assert.equal(
      result.stderr,
      "Preflight failed: Wrangler $schema must reference the installed Wrangler schema\n",
    );
  } finally {
    await Promise.all([rm(fixturePath, { force: true }), rm(schemaPath, { force: true })]);
  }
});

test("preflight rejects a Wrangler config that violates the installed schema", async () => {
  const fixturePath = resolve(
    repositoryRoot,
    `apps/worker/.preflight-invalid-config-${process.pid}.jsonc`,
  );
  const config = JSON.parse(await readFile(primaryConfig, "utf8"));
  config.unsupported_preflight_test_field = true;
  await writeFile(fixturePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  try {
    const result = runPreflight(
      {
        BETTER_AUTH_SECRET: "available-primary-secret",
        BETTER_AUTH_SECRETS: "available-primary-keyring",
      },
      fixturePath,
    );

    assert.equal(result.status, 1);
    assert.equal(
      result.stderr,
      "Preflight failed: Wrangler config schema validation failed at /: must NOT have additional properties\n",
    );
  } finally {
    await rm(fixturePath, { force: true });
  }
});

test("preflight rejects a second secret declaration inside Wrangler config", async () => {
  const fixturePath = resolve(
    repositoryRoot,
    `apps/worker/.preflight-duplicate-secret-authority-${process.pid}.jsonc`,
  );
  const config = JSON.parse(await readFile(primaryConfig, "utf8"));
  config.secrets = { required: ["BETTER_AUTH_SECRET"] };
  await writeFile(fixturePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  try {
    const result = runPreflight(
      {
        BETTER_AUTH_SECRET: "available-primary-secret",
        BETTER_AUTH_SECRETS: "available-primary-keyring",
      },
      fixturePath,
    );

    assert.equal(result.status, 1);
    assert.equal(
      result.stderr,
      "Preflight failed: Wrangler config must not declare secret requirements; use required-secrets.json\n",
    );
  } finally {
    await rm(fixturePath, { force: true });
  }
});

test("preflight rejects a requirements manifest with no deployment entry", async () => {
  const requirementsPath = resolve(
    repositoryRoot,
    `apps/worker/.preflight-missing-requirements-${process.pid}.json`,
  );
  await writeFile(requirementsPath, `${JSON.stringify({ deployments: {} }, null, 2)}\n`, "utf8");

  try {
    const result = runPreflight(
      {
        BETTER_AUTH_SECRET: "available-primary-secret",
        BETTER_AUTH_SECRETS: "available-primary-keyring",
      },
      primaryConfig,
      requirementsPath,
    );

    assert.equal(result.status, 1);
    assert.equal(
      result.stderr,
      "Preflight failed: No secret requirements found for wrangler.jsonc\n",
    );
  } finally {
    await rm(requirementsPath, { force: true });
  }
});

test("remote preflight compares Wrangler secret names without forwarding returned values", () => {
  const unexpectedValue = "remote-value-must-stay-private";
  const result = spawnSync(
    process.execPath,
    [
      preflightScript,
      "--config",
      primaryConfig,
      "--secrets-source",
      "remote",
      "--wrangler-script",
      fakeWranglerScript,
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        FAKE_WRANGLER_SECRET_NAMES:
          "BETTER_AUTH_SECRET,BETTER_AUTH_SECRETS,GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET",
        FAKE_WRANGLER_UNEXPECTED_VALUE: unexpectedValue,
      },
    },
  );

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /4 required secret names are available/u);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(unexpectedValue, "u"));
});

test("remote preflight redacts Wrangler failures", () => {
  const unexpectedValue = "wrangler-error-value-must-stay-private";
  const result = spawnSync(
    process.execPath,
    [
      preflightScript,
      "--config",
      primaryConfig,
      "--secrets-source",
      "remote",
      "--wrangler-script",
      fakeWranglerScript,
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        FAKE_WRANGLER_FAIL: unexpectedValue,
      },
    },
  );

  assert.equal(result.status, 1);
  assert.equal(
    result.stderr,
    "Preflight failed: Unable to list remote secret names with Wrangler\n",
  );
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(unexpectedValue, "u"));
});
