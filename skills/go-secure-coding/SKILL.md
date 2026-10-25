---
name: go-secure-coding
description: Secure coding rules for Go projects. Use whenever writing, reviewing, or changing Go code, adding or upgrading modules, or setting up go.mod, a Dockerfile, or CI for a Go service or CLI. Requires the latest stable Go toolchain, the latest module versions, gofmt/go vet/golangci-lint (with gosec) passing, govulncheck clean, the race detector in tests, and secure Go patterns.
---

# Go Secure Coding

## Hard rules

1. **Latest stable Go.** Look it up; pin it in `go.mod` and CI.
2. **Latest modules.** Every module you add or touch is at its latest release.
   Never write a version from memory.
3. **Checks pass:** `gofmt`, `go vet`, `golangci-lint` (with `gosec` enabled).
4. **`govulncheck` is clean.** It reports only vulnerabilities your code can
   actually reach, so every finding is real work.
5. **Tests run with `-race`.**
6. **Secure patterns.** Follow `references/secure-patterns.md`.

## 1. Go version

```bash
curl -s 'https://go.dev/dl/?mode=json' | jq -r '.[0].version'
# or: git ls-remote --tags https://github.com/golang/go | grep -oE 'go1\.[0-9]+\.[0-9]+$' | sort -V | tail -1
```

Pin it:

```bash
go mod edit -go=1.27 -toolchain=go1.27.3
```

| File | Setting |
|---|---|
| `go.mod` | `go 1.27` and `toolchain go1.27.3` |
| `Dockerfile` | `FROM golang:1.27@sha256:…` (build stage) |
| CI | `go-version-file: go.mod` (setup-go) or `image: golang:1.27` |

`GOTOOLCHAIN=auto` (the default) downloads the toolchain `go.mod` names, so
everyone builds with the same version. Old Go versions get security fixes only
for the latest two minors; never stay on an unsupported one.

## 2. Modules

```bash
go get example.com/pkg@latest      # add, at the latest version
go list -m -u all                  # what's outdated
go get -u ./... && go mod tidy     # upgrade everything (minor/patch)
go mod verify                      # check the module cache against go.sum
```

- Major versions are new import paths (`/v2`); upgrade them deliberately and
  fix the code.
- Commit `go.mod` and `go.sum`. Never edit `go.sum` by hand.
- Keep `GOFLAGS=-mod=readonly` (default) in CI; `GONOSUMDB`/`GOPRIVATE` only
  for your private module paths. Never set `GOFLAGS=-insecure` or
  `GONOSUMCHECK`/`GOSUMDB=off`.
- Prefer the standard library; check a new module is real and maintained.
- Commit upgrades separately (`build: upgrade go modules`).

## 3. Lint

Use `assets/golangci.yml` as `.golangci.yml`. Minimum:

```bash
gofmt -l . | (! grep .)       # no unformatted files
go vet ./...
golangci-lint run
```

- `gosec` findings get fixed. Suppress only a proven false positive, on the
  line, with the rule ID and reason: `//nolint:gosec // G304: path is from a fixed allow-list`.
- No blanket `//nolint`.

## 4. Vulnerabilities

```bash
go install golang.org/x/vuln/cmd/govulncheck@latest
govulncheck ./...
```

Fix by upgrading the module (or Go itself: many findings are in the standard
library). If no fix exists, tell the user which symbol is reachable and from where.

## 5. Tests

```bash
go test -race -shuffle=on ./...
```

Add fuzz tests (`func FuzzX(f *testing.F)`) for parsers and anything handling
untrusted input; run `go test -fuzz=FuzzX -fuzztime=30s` locally.

## 6. Build

```bash
CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o bin/app ./cmd/app
```

Run it in a distroless or scratch image as non-root (see `secure-dockerfiles`).

## Checklist

- [ ] Latest stable Go in `go.mod` (`go` + `toolchain`), Dockerfile and CI
- [ ] Added/touched modules at latest; `go.mod`/`go.sum` tidy and committed
- [ ] `gofmt`, `go vet`, `golangci-lint` clean; any `//nolint` has a rule and reason
- [ ] `govulncheck ./...` clean
- [ ] `go test -race ./...` passes
- [ ] Code follows `references/secure-patterns.md`
