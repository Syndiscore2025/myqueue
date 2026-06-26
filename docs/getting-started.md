# Getting Started

This guide takes you from a fresh clone to a running MyQueue API.

## Prerequisites

- **Node.js 22 LTS** (`node --version` should print `v22.x`)
- **npm 10+**
- **Docker** + **Docker Compose** (for PostgreSQL and Redis)
- **Git**

## 1. Install dependencies

```bash
npm install
```

The `postinstall` hook runs `prisma generate`, producing a typed Prisma client.

## 2. Configure the environment

```bash
cp .env.example .env
```

Then edit `.env`. The only values you must set for local development are already
provided as working defaults. Generate a real encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste the result into `ENCRYPTION_KEY`. See the
[Environment Guide](environment.md) for every variable.

## 3. Start datastores

```bash
docker compose -f docker-compose.dev.yml up -d
```

This launches PostgreSQL on `5432` and Redis on `6379`.

## 4. Run the API

```bash
npm run dev
```

Visit:

- http://localhost:3000/health
- http://localhost:3000/ready
- http://localhost:3000/version
- http://localhost:3000/docs

## 5. Run the background worker (optional)

```bash
npm run dev:worker
```

In Phase 1 the worker boots its runtime and waits — no jobs are registered yet.

## Next steps

- [Local Development Guide](local-development.md)
- [Testing Guide](testing.md)
- [Architecture Overview](architecture.md)
