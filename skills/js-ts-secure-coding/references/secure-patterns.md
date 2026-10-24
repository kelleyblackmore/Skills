# Secure JS/TS patterns

## Code execution

```ts
// Bad
eval(userInput);
new Function("return " + expr)();
setTimeout(userString, 0);            // string form is eval
vm.runInNewContext(code);             // node:vm is NOT a security sandbox

// Good: parse data, don't execute it
const value = JSON.parse(text);       // then validate (zod, valibot)
```

## Child processes

```ts
// Bad: shell injection
exec(`git log ${branch}`);
spawn("sh", ["-c", cmd]);

// Good: no shell, argument array, "--" before user values
execFile("git", ["log", "--", branch], { timeout: 30_000 });
```

## SQL / NoSQL

```ts
// Bad
db.query(`SELECT * FROM users WHERE email = '${email}'`);
users.find({ email: req.body.email });          // {"$ne": null} bypass

// Good
db.query("SELECT * FROM users WHERE email = $1", [email]);
users.find({ email: String(req.body.email) });  // or validate with a schema
```

## Input validation

Validate every external input at the boundary (HTTP bodies, query strings,
headers, env, files, queue messages) with a schema library, and use the
parsed result, not the raw input:

```ts
const Body = z.object({ email: z.string().email(), age: z.number().int().min(0) });
const body = Body.parse(req.body);
```

## Prototype pollution

```ts
// Bad
target[key] = value;                  // key could be "__proto__"
_.merge({}, untrusted);               // with old lodash versions
Object.assign(config, JSON.parse(input));

// Good
const map = new Map<string, unknown>();
const obj = Object.create(null);      // no prototype
if (key === "__proto__" || key === "constructor" || key === "prototype") throw ...
```

Run Node with `--disable-proto=delete` where possible.

## XSS (browser / SSR)

```tsx
// Bad
el.innerHTML = userHtml;
<div dangerouslySetInnerHTML={{ __html: userHtml }} />
<a href={userUrl}>                     // javascript: URLs

// Good
el.textContent = userText;
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userHtml) }} />
const safe = /^https?:\/\//i.test(userUrl) ? userUrl : "#";
```

Set a Content-Security-Policy without `unsafe-inline`/`unsafe-eval`; use
nonces. Use Trusted Types where supported.

## Paths and files

```ts
// Bad
fs.readFile(path.join(UPLOADS, req.params.name));

// Good
const base = path.resolve(UPLOADS);
const target = path.resolve(base, req.params.name);
if (!target.startsWith(base + path.sep)) throw new Error("invalid path");
```

## SSRF

For user-supplied URLs: allow-list scheme (`https:`) and hosts; resolve DNS
and reject private, loopback, and link-local addresses; disable redirects or
re-check each hop; set a timeout (`AbortSignal.timeout(10_000)`).

## Regex DoS

Avoid nested quantifiers on user input (`/(a+)+$/`). Bound input length
before matching; consider `re2` for user-supplied patterns.

## Secrets and crypto

```ts
// Bad
const API_KEY = "sk_live_...";
Math.random().toString(36);           // not for tokens
createHash("md5").update(password);
a === b                               // timing leak on secrets

// Good
const API_KEY = process.env.API_KEY;  // validated at startup
randomBytes(32).toString("base64url");
await argon2.hash(password);          // or bcrypt / scrypt
timingSafeEqual(Buffer.from(a), Buffer.from(b));
```

Never ship secrets to the browser: anything in a client bundle
(`NEXT_PUBLIC_*`, `VITE_*`) is public.

## HTTP servers

- Security headers (helmet or framework equivalent); HSTS in production.
- Cookies: `httpOnly`, `secure`, `sameSite: "lax"` or `"strict"`.
- CSRF protection on cookie-authenticated state-changing routes.
- CORS: explicit origin allow-list, never `*` with credentials.
- Body size limits; rate limiting on auth endpoints.
- Don't leak stack traces; `NODE_ENV=production`.
- JWT: verify with an explicit `algorithms` list; never accept `none`;
  short expiry.

## Deserialization and templates

Never use `node-serialize`, `serialize-javascript` output with `eval`, or
`yaml.load` with custom tags on untrusted input. Don't render user input as a
template (`ejs.render(userTemplate)`, `_.template(userString)`).

## Errors and logging

No empty `catch {}`. Log with a structured logger; never log tokens,
passwords, cookies, or full auth headers. Strip newlines from user values in
log lines.
