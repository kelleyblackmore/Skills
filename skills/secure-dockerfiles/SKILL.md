---
name: secure-dockerfiles
description: Rules for writing and reviewing Dockerfiles and container images securely. Use whenever creating or editing a Dockerfile, Containerfile, .dockerignore, or docker-compose file, choosing a base image, or building/scanning an image. Requires the latest pinned base images, multi-stage builds, a non-root user, no secrets in layers, hadolint passing, and a clean Trivy scan.
---

# Secure Dockerfiles

## Hard rules

1. **Latest base image, pinned.** Use the newest supported tag of the base
   image, pinned by digest: `FROM python:3.15-slim@sha256:…`. Never `:latest`
   on its own and never an end-of-life version.
2. **Minimal runtime image.** Multi-stage build; the final stage has no
   compilers, package managers' caches, or build tools. Prefer `-slim`,
   distroless, or chainguard images.
3. **Non-root.** The final stage runs as a non-root `USER` with a numeric UID.
4. **No secrets in the image.** No `ARG`/`ENV` secrets, no copied `.env`,
   keys, or credentials. Use BuildKit secret mounts.
5. **hadolint passes.** No ignored rules without a reason.
6. **Trivy is clean.** No CRITICAL/HIGH vulnerabilities, misconfigurations, or
   secrets in the built image.

## 1. Pick and pin the base image

Look up the current tags, don't assume them:

```bash
docker buildx imagetools inspect python:3.15-slim     # shows the digest
crane digest python:3.15-slim                         # alternative
```

- Match the language runtime to the latest stable version (see the
  language's secure-coding skill).
- Pin `tag@sha256:digest`. Keep the tag for readability; the digest is what's
  enforced. Let Renovate/Dependabot bump digests.
- Use the same pinned image in every stage that needs it.

## 2. Structure

Start from `assets/Dockerfile.example`. The shape:

```dockerfile
# syntax=docker/dockerfile:1
FROM python:3.15-slim@sha256:<digest> AS build
COPY --from=ghcr.io/astral-sh/uv:0.13.5@sha256:32a7bb39b496babbd997b0a39a4d66c126bdaf5661b302bf6f06abda8deca6ff /uv /bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project
COPY src/ ./src/
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev

FROM python:3.15-slim@sha256:<digest>
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --no-create-home app
WORKDIR /app
COPY --from=build --chown=app:app /app /app
ENV PATH=/app/.venv/bin:$PATH
USER 10001
EXPOSE 8080
HEALTHCHECK CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health')"]
ENTRYPOINT ["python", "-m", "app"]
```

Rules that go with it:

- Copy dependency manifests first, install, then copy source (layer caching).
- `COPY` specific paths, never `COPY . .` without a strict `.dockerignore`
  (see `assets/dockerignore.example`).
- `COPY` over `ADD`. `ADD` only for a local tar you mean to extract.
- Exec-form `ENTRYPOINT`/`CMD` (`["…"]`), so signals reach the process.
- `apt-get`: `--no-install-recommends`, pin versions where practical, and
  `rm -rf /var/lib/apt/lists/*` in the same `RUN`.
- No `curl | sh`. Download, verify the checksum or signature, then run.
- No `sudo`, no `chmod 777`, no SSH server in the image.
- Set `WORKDIR` explicitly; don't build in `/`.

## 3. Secrets

```dockerfile
# Bad: ends up in the image history
ARG NPM_TOKEN
ENV API_KEY=...

# Good: available only during this RUN, never stored in a layer
RUN --mount=type=secret,id=npm_token \
    NPM_TOKEN=$(cat /run/secrets/npm_token) npm ci
```

Build with `docker build --secret id=npm_token,env=NPM_TOKEN .`
Runtime secrets come from the orchestrator (env injection, mounted files,
a secrets manager), never baked in.

## 4. Lint and scan

```bash
hadolint Dockerfile
docker build -t app:check .
trivy image --severity HIGH,CRITICAL --exit-code 1 app:check
trivy config --exit-code 1 .          # Dockerfile / compose misconfigurations
```

- Fix findings by upgrading the base image or the package, not by ignoring.
- Ignoring a hadolint rule: inline, with the rule ID and a reason on the line
  above: `# hadolint ignore=DL3008` plus a comment why.
- A Trivy finding with no fix available: list it in `.trivyignore` with the
  CVE ID, a reason, and an expiry date (`exp:YYYY-MM-DD`), and tell the user.
  Never use `--ignore-unfixed`: it hides every unfixed finding with no record
  of who accepted the risk or until when.

## 5. Runtime (compose / Kubernetes)

- `read_only: true` root filesystem; writable `tmpfs` only where needed.
- Drop all capabilities (`cap_drop: [ALL]`), add back only what's required.
- `no-new-privileges: true` / `allowPrivilegeEscalation: false`.
- Never `privileged: true`, never mount `/var/run/docker.sock`.
- Set memory and CPU limits.
- Bind published ports to `127.0.0.1` in local compose files unless they must
  be reachable from elsewhere.

## 6. Pre-commit and CI

```yaml
- repo: https://github.com/hadolint/hadolint
  rev: v2.15.1          # run `pre-commit autoupdate` for the latest
  hooks:
    - id: hadolint-docker
```

CI builds the image, runs `trivy image` and `trivy config` with
`--exit-code 1`, and only pushes the image when both pass.

## Checklist before reporting done

- [ ] Base image is the latest supported tag, pinned by digest
- [ ] Multi-stage; final stage has no build tools
- [ ] Runs as a numeric non-root `USER`
- [ ] No secrets in `ARG`/`ENV`/`COPY`; `.dockerignore` excludes `.env`, `.git`, keys
- [ ] `hadolint` clean
- [ ] `trivy image` and `trivy config` clean at HIGH/CRITICAL
