# Secure Python patterns

Each entry: what not to do, what to do instead. Bandit/ruff rule IDs in brackets.

## Code execution

```python
# Bad [B307, S307]
result = eval(user_expr)
exec(code_from_request)

# Good: parse data, don't execute it
import ast
value = ast.literal_eval(user_expr)   # literals only
```

## Subprocess

```python
# Bad [B602, S602] – shell injection
subprocess.run(f"git log {branch}", shell=True)
os.system("rm -rf " + path)

# Good – argument list, no shell, check result, absolute or validated binary
subprocess.run(["git", "log", "--", branch], check=True, timeout=30)
```

If a shell is truly needed, quote every argument with `shlex.quote`.

## SQL

```python
# Bad [B608, S608]
cur.execute(f"SELECT * FROM users WHERE name = '{name}'")

# Good – parameters
cur.execute("SELECT * FROM users WHERE name = %s", (name,))
# ORMs: use the query builder; with SQLAlchemy text(), bind params
session.execute(text("SELECT * FROM users WHERE name = :n"), {"n": name})
```

## Deserialization

```python
# Bad [B301, B506]
obj = pickle.loads(data)          # untrusted data = code execution
cfg = yaml.load(text)             # can construct arbitrary objects
# also: marshal, shelve, jsonpickle, dill on untrusted input

# Good
cfg = yaml.safe_load(text)
obj = json.loads(data)            # then validate (pydantic, dataclasses)
```

## XML

```python
# Bad [B314] – XXE, billion laughs
import xml.etree.ElementTree as ET
ET.fromstring(untrusted)

# Good
import defusedxml.ElementTree as ET
ET.fromstring(untrusted)
```

## Secrets and randomness

```python
# Bad [B105, B311]
API_KEY = "sk_live_..."
token = random.choice(string.ascii_letters)

# Good
API_KEY = os.environ["API_KEY"]          # or a secrets manager
token = secrets.token_urlsafe(32)
hmac.compare_digest(given, expected)     # constant-time compare
```

Never log secrets, tokens, passwords, or full request bodies with credentials.
Never commit `.env` files; keep them in `.gitignore`.

## Hashing and crypto

```python
# Bad [B303, B324]
hashlib.md5(password).hexdigest()
hashlib.sha1(data)

# Good
hashlib.sha256(data)                          # integrity
hashlib.md5(data, usedforsecurity=False)      # non-security checksums only
# passwords: argon2-cffi or bcrypt, never a plain hash
from argon2 import PasswordHasher
PasswordHasher().hash(password)
```

Use the `cryptography` package for encryption. Never write your own crypto,
never use ECB mode, never reuse nonces.

## HTTP

```python
# Bad [B113, B501]
requests.get(url)                         # no timeout, hangs forever
requests.get(url, verify=False)           # disables TLS checks

# Good
requests.get(url, timeout=10)             # verify=True is the default
```

For user-supplied URLs (SSRF): allow-list schemes (`https`) and hosts, and
reject private/link-local IPs after DNS resolution.

## Files and paths

```python
# Bad [B108] – predictable temp file, path traversal
open(f"/tmp/{name}", "w")
open(os.path.join(UPLOAD_DIR, user_filename))

# Good
with tempfile.NamedTemporaryFile(delete=False) as f: ...
base = Path(UPLOAD_DIR).resolve()
target = (base / user_filename).resolve()
if not target.is_relative_to(base):
    raise ValueError("invalid path")
```

`tarfile.extractall`: always pass `filter="data"`. `zipfile`: check each
member's resolved path stays inside the destination.

## Web frameworks

- Never `debug=True` in deployed Flask/Django/FastAPI [B201].
- Templates autoescape on; don't mark user input `|safe` / `Markup()`.
- Set `SECRET_KEY` from the environment; secure, HttpOnly, SameSite cookies.
- CSRF protection on state-changing forms.
- Validate all input at the boundary (pydantic, marshmallow, Django forms).
- Bind dev servers to `127.0.0.1`, not `0.0.0.0` [B104], unless in a container.

## Asserts and errors

```python
# Bad [B101] – stripped under python -O
assert user.is_admin

# Good
if not user.is_admin:
    raise PermissionError("admin required")
```

Don't swallow exceptions (`except Exception: pass`) [B110]. Don't return stack
traces or internal errors to clients.

## Logging

Use `logging` with parameters (`log.info("user %s", user_id)`), not f-strings
of untrusted data. Strip newlines from user input before logging to prevent
log forging.
