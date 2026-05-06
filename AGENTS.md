# AGENTS.md

## Project Structure

- `src/client`: React/Vite PWA and iPhone-first scanner UI
- `src/server`: Express backend, upload handling, storage, AI providers, DB repositories
- `src/shared`: shared receipt types, money parsing, validation, status transitions
- `migrations`: additive DB migrations only
- `tests`: unit tests for validation, money, schema, storage safety, repository behavior
- `public`: PWA manifest and icon

## Commands

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
npm start
```

## No-Secrets Rule

- Never commit `.env`.
- Never hardcode real secrets.
- Never expose `OPENAI_API_KEY`, DB credentials, SSH keys, tokens, or private URLs to the frontend.
- Use `.env.example` placeholders only.
- Do not log secrets; logger redacts common secret paths.

## Database Safety

- This project integrates with an existing invoice/accounting DB.
- Inspect existing schema before adding production migrations.
- Use additive migrations only.
- Do not drop, rename, or destructively rewrite existing tables.
- Keep receipt scanner tables linkable to existing invoices/users/companies.
- Keep `ALLOW_ADDITIVE_MIGRATIONS=false` in production until schema review is complete.

## Coding Conventions

- TypeScript strict mode.
- Keep backend-only AI and DB code under `src/server`.
- Keep validation deterministic in `src/shared`.
- Store money internally as integer cents plus raw printed string.
- Preserve AI raw output and manual edit audit history.
- Prefer small provider/repository interfaces over direct coupling.

## Design Rules

- UI text is Latvian by default.
- Mobile-first, iPhone Safari safe-area aware.
- Large touch targets around 44px or larger.
- Light and dark mode.
- Premium, clean, restrained interface.
- Do not copy Apple apps, icons, logos, trademarks, or protected visual identity.
- Avoid Bootstrap/admin-template styling.

## Done Criteria

- App runs locally.
- `npm run typecheck` passes.
- `npm test` passes.
- `npm run build` passes.
- No secrets committed.
- `.env.example` is updated for new env vars.
- README documents DB, deployment, validation, and known limitations.
- PR summary includes scope, tests, deployment notes, and screenshots if UI changed.

## PR Instructions

- Work on a branch prefixed with `codex/`.
- Do not push directly to `main`.
- Keep commits intentional and scoped.
- Open a pull request against `main` when a base branch exists.
- If the GitHub repository is empty and `main` does not exist yet, push the feature branch and document that a base branch must be created before a PR can be opened.
