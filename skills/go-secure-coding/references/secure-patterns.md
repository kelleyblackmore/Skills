# Secure Go patterns

gosec rule IDs in brackets.

## Commands

```go
// Bad [G204]: shell, string-built command
exec.Command("sh", "-c", "git log "+branch).Run()

// Good: fixed binary, argument list, "--end-of-options" before user values, context timeout
ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
defer cancel()
//nolint:gosec // G204: fixed binary and argument list, no shell; branch follows --end-of-options
out, err := exec.CommandContext(ctx, "git", "log", "--end-of-options", branch, "--").Output()
```

## SQL

Don't rely on the linter here: gosec's SQL rules (G201/G202) missed every
string-built query in our tests, so check for this by eye in review.

```go
// Bad: SQL injection
db.Query(fmt.Sprintf("SELECT * FROM users WHERE email = '%s'", email))
db.QueryContext(ctx, "SELECT * FROM users WHERE email = '"+email+"'")

// Good
db.QueryContext(ctx, "SELECT * FROM users WHERE email = $1", email)
```

## Files and paths

```go
// Bad [G304]: path traversal
os.ReadFile(filepath.Join(uploadDir, r.URL.Query().Get("name")))

// Good (Go 1.24+): os.Root confines every operation to the directory,
// including symlinks that point outside it.
root, err := os.OpenRoot(uploadDir)
if err != nil { return err }
defer root.Close()
f, err := root.Open(name)   // "../x" and escaping symlinks fail
```

Archives (zip/tar): reject entries whose cleaned path is absolute or contains
`..` before extracting (or extract through an `os.Root`) [G305].
File permissions: `0o600` for secrets, `0o644`/`0o755` otherwise [G302, G306].

## HTTP servers

```go
// Bad [G114]: no timeouts, slowloris
http.ListenAndServe(":8080", mux)

// Good
srv := &http.Server{
    Addr:              ":8080",
    Handler:           mux,
    ReadHeaderTimeout: 5 * time.Second,
    ReadTimeout:       15 * time.Second,
    WriteTimeout:      15 * time.Second,
    IdleTimeout:       60 * time.Second,
    MaxHeaderBytes:    1 << 20,
}
```

Limit request bodies: `r.Body = http.MaxBytesReader(w, r.Body, 1<<20)`.
Use `http.NewCrossOriginProtection()` (Go 1.25+) or a CSRF library for
cookie-authenticated forms.

## HTTP clients

```go
// Bad: http.Get uses DefaultClient, which has no timeout
resp, err := http.Get(url)

// Good
client := &http.Client{Timeout: 10 * time.Second}
req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
if err != nil { return err }   // a malformed URL gives a nil req; Do(nil) panics
resp, err := client.Do(req)
if err != nil { return err }
defer resp.Body.Close()
body, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
```

Never set `InsecureSkipVerify: true` [G402]. Set `MinVersion: tls.VersionTLS12`
(or 1.3) on custom `tls.Config`s. For user-supplied URLs (SSRF), allow-list hosts
and block private IPs in a custom `net.Dialer.Control`.

## Crypto and randomness

```go
// Bad [G404, G401, G501]
token := fmt.Sprint(rand.Int())     // math/rand
h := md5.Sum(password)

// Good
token := rand.Text()                // crypto/rand, Go 1.24+ (base32, 128+ bits)
hash, err := bcrypt.GenerateFromPassword(pw, bcrypt.DefaultCost)  // or argon2id
subtle.ConstantTimeCompare(a, b) == 1
```

## Templates

Use `html/template`, not `text/template`, for anything rendered as HTML.
Don't wrap untrusted input in `template.HTML`/`template.JS` [G203].

## Integer conversions

Check bounds before narrowing (`int` → `int32`, `uint64` → `int`) on values
from input [G115]; a silent overflow can bypass a length check.

## Concurrency

- Run tests with `-race`.
- Every goroutine has a way to stop (context cancel, closed channel).
- Don't share maps across goroutines without a mutex or `sync.Map`.

## Errors and logging

- Check every error (`errcheck`); wrap with `%w`.
- Use `log/slog`; never log secrets, tokens, or full request bodies.
- Return generic errors to clients; log details server-side.

## Unsafe

Avoid `unsafe` and `reflect` tricks [G103]; if needed, isolate and document why.
