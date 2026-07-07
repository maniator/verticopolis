# Security Policy

## Supported versions

Verticopolis is a continuously deployed browser game — the live build at
[verticopolis.com](https://verticopolis.com) is the only supported version.
Please confirm an issue reproduces on the latest build before reporting.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.** Public
issues are visible to everyone and can put players at risk before a fix ships.

Instead, report privately through GitHub's
[Private Vulnerability Reporting](https://github.com/maniator/verticopolis/security/advisories/new):

1. Go to the repository's **Security** tab → **Report a vulnerability**, or use
   the link above.
2. Describe the issue, the impact, and the steps to reproduce it.
3. Include the build version (shown on the splash screen) and, if relevant, a
   saved tower export (`.vctower`) or a minimal reproduction.

Because the game runs entirely client-side, please pay particular attention to
anything involving **imported save data** (`.vctower` / save-game import), since
that is the main path by which untrusted input enters the app.

## What to expect

- We aim to acknowledge a report within a few days.
- We'll keep you updated as we confirm, fix, and release the change.
- With your permission, we're happy to credit you once a fix has shipped.

Thank you for helping keep Verticopolis and its players safe.
