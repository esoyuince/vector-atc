# Security

## Credentials and deployment

- Keep `TYPESAFE_API_KEY` in ignored `.dev.vars` locally and a Cloudflare Worker secret in production. Never use a `VITE_*` variable for secrets.
- Copy `wrangler.example.jsonc` to ignored `wrangler.jsonc`; configure your own account/domain and token allowance. AI is disabled in the template.
- Do not commit environment files, Worker local state, logs, screenshots of account panels, exported reports, replay archives or private keys. `.gitignore` is a safeguard, not a secret detector; `git add -f` can bypass it.
- Before publishing changes, review `git diff --cached` and scan committed history with [Gitleaks](https://github.com/gitleaks/gitleaks), using redacted output. Never paste discovered values into issues or pull requests.
- If a credential is disclosed, revoke/rotate it first; deleting a file or rewriting history alone does not invalidate it.

## Reporting

Use GitHub's **Security → Report a vulnerability** for a private report. Do not create a public issue containing credentials, account data or exploit details. Include the affected commit, relevant component and a minimal sanitized reproduction.

This is an experimental simulator, not safety-critical aviation equipment. Flight-decision limitations are documented in the README; report software security defects separately from unsafe simulated AI decisions.
