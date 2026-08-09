/**
 * Build-time guard for the Android Digital Asset Links file (PRD F5, N2).
 *
 * `src/public/.well-known/assetlinks.json` is what lets an Android TWA prove it
 * speaks for verticopolis.com. Without it the app still runs, but Chrome draws
 * a Custom Tab address bar across the top, so it reads as a dressed-up browser
 * window rather than an app. That failure is silent in both directions: the web
 * site is completely unaffected, and nothing in the game's own tests would ever
 * notice.
 *
 * Delivery rests on two defaults rather than on anything this repo states.
 * Vite's `root` is `src`, so `publicDir` falls back to `src/public/`, and
 * `build.copyPublicDir` defaults to true; the copy itself is a bare
 * `readdirSync` recursion with no dotfile filter, which is the only reason a
 * DOT-directory survives it. Flip either default, move `root`, or upgrade to a
 * Vite that filters dotfiles, and the file stops reaching `dist/` while every
 * build stays green. This guard turns that into a failed build.
 *
 * TEMPORARY ENTRY, and the reason this file is worth reading before editing the
 * JSON: the fingerprint shipping today belongs to a SIDELOAD key on the owner's
 * machine, published so a test build could be installed on a phone before the
 * Play Console record existed. Any app signed with that key is trusted as a
 * verified first-party app for the domain. It must be REMOVED once the Play App
 * Signing fingerprint is added at store launch. Tracked in the backlog as
 * `assetlinks-sideload-fingerprint` (issue #799).
 *
 * This checks shape only. Whether a fingerprint belongs to the right key is a
 * question only Google's asset-links tester and a real device can answer.
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs it directly.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", ".well-known", "assetlinks.json");

/** The package name the committed Bubblewrap manifest builds. A mismatch here
 *  means the file names an app nobody ships, which verifies for nothing. */
const PACKAGE = "io.github.maniator.verticopolis";
const HANDLE_ALL_URLS = "delegate_permission/common.handle_all_urls";
/** 32 colon-separated hex pairs: 64 hex characters, the SHA-256 of the signing
 *  certificate. Case is accepted either way because the comparison Google makes
 *  is on the decoded bytes, so a lowercase file verifies exactly as well and
 *  rejecting it would turn the build red over nothing. The colons are still
 *  required, which does rule out `apksigner verify --print-certs` output: that
 *  prints the digest unseparated, and the error message asks for the `keytool`
 *  form so the committed file keeps one shape. */
const FINGERPRINT = /^([0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/;

function fail(msg: string): never {
  console.error(`verify-assetlinks: ${msg}`);
  process.exit(1);
}

let raw: string;
try {
  raw = readFileSync(FILE, "utf8");
} catch (err) {
  // The error is quoted rather than assumed away: EACCES on a runner and
  // EISDIR both land here, and blaming the Vite config for either sends the
  // reader through three settings before they think to look at the path.
  fail(
    `cannot read ${FILE} (${(err as Error).message}). It ships from ` +
      "src/public/.well-known/assetlinks.json; if that file is present and this says ENOENT, " +
      "Vite stopped copying the public dir (check `root`, `publicDir` and `build.copyPublicDir`).",
  );
}

let parsed: unknown;
try {
  parsed = JSON.parse(raw);
} catch (err) {
  fail(`${FILE} is not valid JSON (${(err as Error).message}). Google's verifier rejects it outright.`);
}

if (!Array.isArray(parsed) || parsed.length === 0) {
  fail("assetlinks.json must be a non-empty ARRAY of statements; an object is rejected by the verifier.");
}

type Statement = {
  relation?: unknown;
  target?: { namespace?: unknown; package_name?: unknown; sha256_cert_fingerprints?: unknown };
};

// `s?.` guards the ELEMENT, not just its target: `[null]` is valid non-empty
// JSON, and a raw TypeError explains nothing to whoever has to fix the file.
const statements = parsed as Array<Statement | null>;
const ours = statements.filter((s) => s?.target?.package_name === PACKAGE);
if (ours.length === 0) {
  const seen = statements.map((s) => String(s?.target?.package_name ?? "(none)")).join(", ");
  fail(`no statement for ${PACKAGE}. Found: ${seen}`);
}

// EVERY matching statement, not only the first. Play Console hands over a whole
// statement object to paste, so the likely next edit adds a second element for
// the same package rather than a second fingerprint in this one. Checking only
// the first would wave that pasted statement straight through.
let total = 0;
for (const [i, statement] of ours.entries()) {
  const where = ours.length === 1 ? PACKAGE : `${PACKAGE} (statement ${i + 1} of ${ours.length})`;
  if (!Array.isArray(statement!.relation) || !statement!.relation.includes(HANDLE_ALL_URLS)) {
    fail(`${where} must declare the "${HANDLE_ALL_URLS}" relation, or the TWA is not trusted.`);
  }
  if (statement!.target?.namespace !== "android_app") {
    fail(`${where} must have namespace "android_app", got ${JSON.stringify(statement!.target?.namespace)}.`);
  }
  const prints = statement!.target?.sha256_cert_fingerprints;
  if (!Array.isArray(prints) || prints.length === 0) {
    // An empty array parses, deploys, and verifies for nobody, which is the
    // worst shape available: it looks finished.
    fail(`${where} lists no sha256_cert_fingerprints. The file would deploy and verify for no key at all.`);
  }
  for (const print of prints) {
    if (typeof print !== "string" || !FINGERPRINT.test(print)) {
      fail(
        `bad fingerprint ${JSON.stringify(print)} in ${where}. Expected 32 colon-separated hex pairs, ` +
          "written as `keytool -list -v` prints them.",
      );
    }
  }
  total += prints.length;
}

console.log(
  `verify-assetlinks: ${PACKAGE} declared in ${ours.length} statement${ours.length === 1 ? "" : "s"} ` +
    `with ${total} fingerprint${total === 1 ? "" : "s"}`,
);
