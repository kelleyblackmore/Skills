---
name: js-ts-secure-coding
description: Secure coding rules for JavaScript and TypeScript projects (Node.js, browser, React/Next and similar). Use whenever writing, reviewing, or changing JS/TS code, adding or upgrading npm/pnpm/yarn dependencies, or setting up package.json, tsconfig, ESLint, a Dockerfile, or CI for a JS project. Requires the latest Node.js LTS, the latest package versions, ESLint with security rules, strict TypeScript, a clean npm audit, and secure coding patterns.
---

# JS/TS Secure Coding

## Hard rules

1. **Latest Node.js LTS.** Target the newest Active LTS line, latest patch.
2. **Latest packages.** Every dependency you add or touch is at its latest
   release. Never write a version from memory: look it up.
3. **Lint and types pass.** ESLint (with `typescript-eslint` and
   `eslint-plugin-security`) and `tsc --noEmit` under `strict` are clean.
4. **No known vulnerabilities.** `npm audit --audit-level=high` is clean
   (`pnpm audit` / `yarn npm audit` equivalents).
5. **Lock file committed, installs reproducible.** `npm ci`, never `npm install`
   in CI.
6. **Secure patterns.** Follow `references/secure-patterns.md`.

## 1. Node.js version

```bash
curl -s https://nodejs.org/dist/index.json \
  | jq -r '[.[] | select(.lts != false)][0] | "\(.version) \(.lts)"'
```

Even-numbered releases become LTS in October; once the new line is LTS, move
to it. Make every pin agree:

| File | Setting |
|---|---|
| `package.json` | `"engines": { "node": ">=24" }` |
| `.nvmrc` / `.node-version` | `24` |
| `Dockerfile` | `FROM node:24-slim@sha256:…` |
| CI | `node-version: 24` / `image: node:24…` |
| `tsconfig.json` | `target`/`lib` matching that Node (e.g. `ES2024`) |
| `@types/node` | major matching the Node line |

Never stay on an end-of-life Node line.

## 2. Packages

**Adding:** check the latest version and that it's the real package
(exact name, maintainer, weekly downloads, repo link, recent releases):

```bash
npm view <pkg> version repository.url maintainers time.modified
npm install <pkg>@latest
```

Prefer built-ins (`fetch`, `crypto`, `node:test`, `structuredClone`) over a
dependency. Avoid tiny single-function packages.

**Upgrading:**

```bash
npm outdated
npx npm-check-updates -u && npm install   # or: pnpm up --latest / yarn up
npm test
```

Fix code for breaking changes in majors; hold a package back only with a
comment naming the blocker.

Peer-dependency conflicts are real blockers: never `--force` or
`--legacy-peer-deps` past them. Use the newest version the peer range
allows and note it. Example: when TypeScript 7 shipped, `typescript-eslint`
still required `typescript <6.1`, so the latest usable TypeScript was 6.0.x:

```bash
npm view typescript-eslint@latest peerDependencies
npm i -D 'typescript@<6.1'
```

Commit upgrades separately (`build: upgrade dependencies`).

**Supply chain:**

- Commit `package-lock.json` / `pnpm-lock.yaml` / `yarn.lock`; CI uses
  `npm ci` / `pnpm install --frozen-lockfile` / `yarn install --immutable`.
- Consider `npm ci --ignore-scripts` (or pnpm's default of not running
  dependency build scripts) and allow-list packages that need install scripts.
- `npm audit signatures` to verify registry signatures/provenance.
- Publish your own packages with `npm publish --provenance`.
- Scoped private packages: set the registry per scope in `.npmrc` to prevent
  dependency confusion. Never commit `.npmrc` tokens.

## 3. Lint, format, types

Use `assets/eslint.config.mjs` and `assets/tsconfig.strict.json` as the
baseline.

```bash
npx eslint . --max-warnings 0
npx prettier --check .
npx tsc --noEmit
```

- TypeScript `strict: true` plus `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`.
- No `any` without a comment explaining why; prefer `unknown` + narrowing.
- Suppress a rule only on the line, with the rule name and a reason:
  `// eslint-disable-next-line security/detect-object-injection -- key is from a fixed enum`.
  Never a file-wide or blanket `eslint-disable`, never `@ts-ignore`
  (use `@ts-expect-error` with a reason if unavoidable).

## 4. Audit

```bash
npm audit --audit-level=high
npm audit fix                 # non-breaking fixes
```

If a fix needs a major upgrade, do the upgrade and fix the code. If a
transitive package has no fixed parent release, use `overrides` (npm) /
`pnpm.overrides` / `resolutions` (yarn) to force the patched version, with a
comment, and tell the user. If no fix exists at all, report the advisory and
whether the vulnerable path is reachable.

## 5. Pre-commit and CI

pre-commit (or husky + lint-staged) runs ESLint, Prettier, and `tsc`; CI runs
`npm ci`, lint, typecheck, tests, `npm audit --audit-level=high`, and
`npm audit signatures` on the latest LTS. See the `ci-pipelines` skill.

## Checklist before reporting done

- [ ] Node is the latest LTS in every pin; `@types/node` matches
- [ ] Added/touched packages at latest; lock file regenerated and committed
- [ ] `eslint`, `prettier --check`, `tsc --noEmit` clean
- [ ] `npm audit --audit-level=high` clean
- [ ] Code follows `references/secure-patterns.md`
- [ ] Tests pass
