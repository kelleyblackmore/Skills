---
name: container-build-scan
description: Pipeline for building container images and gating them on scans before they are pushed. Use whenever building, scanning, or publishing a container image, or setting up a container CI/CD pipeline. Lints the Containerfile/Dockerfile with hadolint, builds a labelled image pinned by digest, generates a CycloneDX SBOM with syft, scans it with hoppr-cop (grype + trivy) behind a severity gate, checks compliance with OpenSCAP (DISA STIG / CIS profiles), then signs and pushes. Nothing is pushed unless every gate passes.
---

# Container Build and Scan

How to write the Dockerfile itself is in `secure-dockerfiles`. This skill is
the pipeline around it.

```
hadolint ─► build ─► SBOM (syft) ─► hoppr-cop ─► gate ─► OpenSCAP ─► sign ─► push
   │          │                         │          │         │
 fail       fail                     report     fail on    fail on
                                                high+     rule fail
```

## Hard rules

1. **hadolint passes** with `assets/hadolint.yaml` (`failure-threshold: info`).
2. **Build is reproducible and labelled**: pinned base image digest, OCI labels
   (`source`, `revision`, `version`), tagged with the git commit SHA.
3. **Every image gets a CycloneDX SBOM** from syft, kept as a build artifact.
4. **hoppr-cop scans the SBOM, and `scripts/hopprcop_gate.py` decides.**
   hoppr-cop always exits 0, even with critical findings, so never use its exit
   code as the gate.
5. **OpenSCAP compliance passes** for the image's distro with the agreed
   profile (DISA STIG by default), using a tailoring file only for rules a
   container can't meet, each with a reason.
6. **Accepted risks are explicit**: listed in `analysis.assessment.yml` with a
   date, state, justification and detail, and re-reviewed when they expire.
7. **Push only after every gate passes**, then sign and attach the SBOM.

## 1. Lint: hadolint

```bash
hadolint -c .hadolint.yaml Containerfile
```

Use `assets/hadolint.yaml`. It fails on every finding, forbids `:latest`,
`ADD` for local files, shell-form `CMD`, pipes without `pipefail`, and a root
final `USER`. It also requires the OCI labels and limits `FROM` to trusted
registries.

Ignore a rule only on the line it applies to, with the reason on the line
above. Never raise `failure-threshold` to get a build through.

## 2. Build

```bash
GIT_SHA=$(git rev-parse HEAD)
podman build \
  --label org.opencontainers.image.source="$REPO_URL" \
  --label org.opencontainers.image.revision="$GIT_SHA" \
  --label org.opencontainers.image.version="$VERSION" \
  --pull=always -t "$IMAGE:$GIT_SHA" -f Containerfile .
podman save --format oci-archive -o image.tar "$IMAGE:$GIT_SHA"
```

- `podman`/`buildah` (rootless) or `docker buildx build --load` both work; use
  whatever the CI runner has.
- Base image pinned by digest, latest supported tag (see `secure-dockerfiles`).
- Tag with the commit SHA. Add `latest`/semver tags only when promoting a
  scanned, signed image.
- Keep `image.tar`: every scan below reads the same bytes that get pushed.

## 3. SBOM: syft

```bash
syft oci-archive:image.tar -o cyclonedx-json=sbom.cdx.json
```

Note the OS syft detected, since hoppr-cop needs it:

```bash
jq -r '.metadata.properties[]? | select(.name|test("syft:distro:(id|versionID)")) | .value' sbom.cdx.json
```

## 4. Vulnerabilities: hoppr-cop plus the gate

Install with the latest Python. hoppr-cop 2.2.1 imports `distutils`, which
Python 3.12+ removed, so add `setuptools` alongside it:

```bash
uv tool install hoppr-cop --with setuptools
# or: pipx install hoppr-cop && pipx inject hoppr-cop setuptools
```

hoppr-cop calls the `grype` and `trivy` CLIs, so install both at their latest
versions. Options go **before** the SBOM path:

```bash
hoppr-cop -s grype -s trivy \
  --os-distro "debian:13" \
  --assessment . \
  -f table -f cyclone_dx -f gitlab \
  -b app -d reports \
  sbom.cdx.json

python3 scripts/hopprcop_gate.py reports/app-enhanced.json --fail-on high
```

- `--os-distro` must match the image (`rhel:9`, `debian:13`, `ubuntu:24.04`),
  or OS package findings are wrong or missing.
- `--assessment .` loads `./analysis.assessment.yml` (see
  `assets/analysis.assessment.yml`).
- `-f gitlab` writes `gl-dependency-scanning-report.json` for GitLab's
  security widget; `-f cyclone_dx` writes the enhanced SBOM the gate reads.
- The gate fails on any finding at or above `--fail-on` (default `high`) unless
  it has an accepted assessment. It uses the highest severity any source gives,
  which is stricter than hoppr-cop's own table.
- Assessments older than `--assessment-max-age` days (default 180) fail again.

**Fix findings by updating the base image or the package**, then rebuild. To
accept a risk, add an entry to `analysis.assessment.yml` with `state`
(`not_affected`, `false_positive`, …), a `justification`, a `detail` saying why
and who reviewed it, and the exact package and version. hoppr-cop rejects
incomplete entries. Tell the user about every accepted risk.

## 5. Compliance: OpenSCAP

Use the latest SCAP Security Guide content (ComplianceAsCode release, or the
`scap-security-guide` package) and the data stream for the image's distro and
major version: `ssg-rhel9-ds.xml` for UBI 9, `ssg-debian13-ds.xml` for Debian 13,
`ssg-ubuntu2404-ds.xml` for Ubuntu 24.04. Images with no OS packages
(distroless, scratch) have no SSG content; skip this step and say so.

```bash
oscap info --profiles ssg-rhel9-ds.xml            # list profiles

sudo oscap-podman "$IMAGE:$GIT_SHA" xccdf eval \
  --profile xccdf_org.ssgproject.content_profile_stig \
  --tailoring-file container-tailoring.xml \
  --results-arf arf.xml --report oscap-report.html \
  ssg-rhel9-ds.xml
```

- **Exit codes:** 0 means every rule passed, 2 means at least one failed, 1
  means the scan errored. Fail the pipeline on anything but 0.
- Use `oscap-podman` (or `oscap-docker`). They scan the image as a container,
  so SSG marks host-only rules (partitions, bootloader, kernel, `/dev/shm`
  mount options) *not applicable*. Scanning an extracted root filesystem with
  `oscap-chroot` misses that and reports them as failures, unless the
  filesystem has `/run/.containerenv`.
- **Tailoring:** drop only rules the runtime controls, never ones the image
  can meet. Example: DNS servers come from the runtime, not the image.
  ```bash
  autotailor --title "STIG for container images" \
    -u network_configure_name_resolution \
    -p stig_container -o container-tailoring.xml ssg-rhel9-ds.xml stig
  # then use --profile xccdf_org.ssgproject.content_profile_stig_container
  ```
  Commit the tailoring file, with the reason for each removed rule in the MR.
- **Fixing failures:** generate the remediation for exactly what failed, review
  it, and move the relevant lines into the Containerfile:
  ```bash
  oscap xccdf generate fix --fix-type bash --tailoring-file container-tailoring.xml \
    --result-id "$(grep -oP 'TestResult[^>]* id="\K[^"]+' results.xml | head -1)" results.xml > fix.sh
  ```
  Generated fixes assume their tools are installed. For example, the crypto
  policy fix needs `crypto-policies-scripts`, which `ubi-minimal` lacks. Install
  what they need, rebuild, rescan, and repeat until the scan passes.

## 6. Sign and push

Only after steps 1–5 pass:

```bash
podman push "$IMAGE:$GIT_SHA"
DIGEST=$(skopeo inspect --format '{{.Digest}}' "docker://$IMAGE:$GIT_SHA")
cosign sign --yes "$IMAGE@$DIGEST"                                    # keyless via OIDC in CI
cosign attest --yes --type cyclonedx --predicate sbom.cdx.json "$IMAGE@$DIGEST"
```

Deploy by digest, never by tag. Keep the reports (hoppr-cop HTML/JSON, gate
output, OpenSCAP ARF + HTML) as pipeline artifacts.

## 7. CI

Templates: `assets/gitlab-ci.example.yml` and
`assets/github-actions.example.yml`. They run the steps above as separate jobs
with artifacts passed between them, and push only from the final job. Pin
every action and image by digest/SHA (see `ci-pipelines`).

## Checklist

- [ ] `hadolint` clean with the shared config
- [ ] Image built from a digest-pinned base, OCI-labelled, tagged with the commit SHA
- [ ] CycloneDX SBOM generated and stored
- [ ] hoppr-cop run with the right `--os-distro`; `hopprcop_gate.py` passes
- [ ] Every accepted risk is in `analysis.assessment.yml` with justification and detail
- [ ] `oscap-podman` passes the profile (exit 0); any tailored-out rule has a reason
- [ ] Pushed only after all gates; signed; SBOM attested; deployed by digest
