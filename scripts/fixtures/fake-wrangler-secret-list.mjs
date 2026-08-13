const expectedArguments = ["secret", "list", "--config"];
if (process.env.FAKE_WRANGLER_FAIL) {
  console.error(process.env.FAKE_WRANGLER_FAIL);
  process.exitCode = 1;
} else if (!expectedArguments.every((argument, index) => process.argv[index + 2] === argument)) {
  process.exitCode = 2;
} else if (process.argv.at(-2) !== "--format" || process.argv.at(-1) !== "json") {
  process.exitCode = 2;
} else {
  const names = (process.env.FAKE_WRANGLER_SECRET_NAMES ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  console.log(
    JSON.stringify(
      names.map((name) => ({
        name,
        type: "secret_text",
        unexpectedValue: process.env.FAKE_WRANGLER_UNEXPECTED_VALUE,
      })),
    ),
  );
}
