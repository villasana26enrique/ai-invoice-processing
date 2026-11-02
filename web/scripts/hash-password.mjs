// Prints the REVIEWER_PASSWORD_HASH for a password: node web/scripts/hash-password.mjs
// The password is typed at the prompt, not passed as an argument: the shell cannot alter it ($, !, quotes)
// and it does not end up in the command history.
import { randomBytes, scryptSync } from "node:crypto";
import { createInterface } from "node:readline";

// Reads the two answers line by line (also works when they are piped in)
const lines = createInterface({ input: process.stdin })[Symbol.asyncIterator]();
const ask = async (question) => {
  process.stderr.write(question);
  return (await lines.next()).value ?? "";
};
const password = await ask("Password (10+ characters): ");
const again = await ask("Same password again: ");
process.stdin.pause();

if (password.length < 10) {
  console.error("Too short: use at least 10 characters.");
  process.exit(1);
}
if (password !== again) {
  console.error("The two passwords do not match.");
  process.exit(1);
}
const salt = randomBytes(16);
console.log(`scrypt:${salt.toString("hex")}:${scryptSync(password, salt, 32).toString("hex")}`);
