# Local Development Guide

## Recommended workflow

1. Start datastores once and leave them running:

   ```bash
   docker compose -f docker-compose.dev.yml up -d
   ```

2. Run the API (and optionally the worker) with hot reload:

   ```bash
   npm run dev
   npm run dev:worker   # in a second terminal
   ```

Both use `tsx watch`, so changes restart the process automatically.

## Quality gates

Run these locally before pushing — CI runs the same checks:

```bash
npm run lint          # ESLint, zero warnings allowed
npm run format:check  # Prettier formatting
npm run typecheck     # tsc --noEmit (strict)
npm test              # Jest
npm run build         # tsc -> dist/
```

Auto-fix formatting with `npm run format`.

## Working with Prisma

The Prisma schema lives in `prisma/schema.prisma`. Phase 1 defines **no models**
— only the datasource and generator.

Regenerate the client after schema edits:

```bash
npm run prisma:generate
```

When you add your first model (a later phase), create a migration:

```bash
npx prisma migrate dev --name <change-name>
```

In deployed environments, apply migrations with:

```bash
npm run prisma:migrate   # prisma migrate deploy
```

## Coding standards

- **Strict TypeScript** — no `any`, no implicit returns, no unused symbols.
- **Relative imports** within `src/` (no path-alias build step required).
- **Type-only imports** must use `import type`.
- **No `console`** in application code — use the Pino `logger`.
- Keep classes and services small and single-purpose.

## Editor setup

Enable "format on save" with the Prettier extension and the ESLint extension.
The repository ships `.prettierrc.json` and `eslint.config.mjs`, so editors pick
up the project rules automatically.

## Troubleshooting

- **Env validation error on boot** — a required variable is missing/invalid; the
  error message lists exactly which one. See [environment.md](environment.md).
- **`/ready` returns 503** — PostgreSQL or Redis is unreachable. Confirm the dev
  datastores are running.
- **Prisma client errors** — run `npm run prisma:generate`.
