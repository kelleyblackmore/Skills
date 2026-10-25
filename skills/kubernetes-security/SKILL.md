---
name: kubernetes-security
description: Secure rules for Kubernetes manifests and Helm charts. Use whenever writing, reviewing, or changing Kubernetes YAML (Deployments, StatefulSets, Jobs, Services, Ingress, RBAC, NetworkPolicy), Helm charts or values, Kustomize overlays, or cluster CI. Requires Pod Security Standards "restricted" settings, pinned images, resource limits, least-privilege RBAC, default-deny NetworkPolicies, no plain Secrets in git, and kubeconform, kube-linter and trivy config passing.
---

# Kubernetes Security

## Hard rules

1. **Restricted pod security.** Every workload meets the Pod Security
   Standards *restricted* profile: non-root, no privilege escalation, all
   capabilities dropped, `RuntimeDefault` seccomp, read-only root filesystem.
2. **Pinned images.** `registry/image:tag@sha256:…`, latest supported tag,
   never `:latest`.
3. **Requests and limits** for CPU and memory on every container.
4. **Least-privilege RBAC.** No `cluster-admin`, no `*` verbs or resources; a
   dedicated ServiceAccount per workload; `automountServiceAccountToken: false`
   unless the pod calls the API.
5. **Default-deny networking.** A default-deny NetworkPolicy per namespace,
   then explicit allows.
6. **No plain Secrets in git.** Use External Secrets / CSI secrets store, or
   SOPS / Sealed Secrets (see `secrets-management`).
7. **Checks pass:** `kubeconform`, `kube-linter`, `trivy config`; for charts
   also `helm lint`.

## 1. Workload template

Start from `assets/deployment.yaml`. The parts that matter:

```yaml
spec:
  template:
    spec:
      serviceAccountName: app
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        runAsGroup: 10001
        fsGroup: 10001
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: app
          image: registry.example.com/app:1.4.2@sha256:<digest>
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          resources:
            requests: { cpu: 100m, memory: 128Mi }
            limits: { memory: 256Mi }
          livenessProbe: …
          readinessProbe: …
          volumeMounts:
            - { name: tmp, mountPath: /tmp }
      volumes:
        - { name: tmp, emptyDir: {} }
```

Never: `privileged: true`, `hostNetwork`, `hostPID`, `hostIPC`, `hostPath`
volumes, `hostPort`, added capabilities (beyond `NET_BIND_SERVICE` if truly
needed), or mounting the container runtime socket.

Label namespaces to enforce it:

```yaml
metadata:
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: latest
```

## 2. Images

- Latest supported tag of a minimal base (see `secure-dockerfiles`), pinned by digest.
- `imagePullPolicy: IfNotPresent` with digests (the digest makes it immutable).
- Pull only from registries you trust; enforce with an admission policy
  (Kyverno / Gatekeeper / ValidatingAdmissionPolicy).
- Scan: `trivy image <ref>` in CI before deploy.

## 3. RBAC

- Namespaced `Role` + `RoleBinding` over `ClusterRole` wherever possible.
- List exact `resources`, `verbs` and, where possible, `resourceNames`.
- Never grant `secrets` `list`/`watch` broadly, `pods/exec`, `escalate`,
  `bind`, or `impersonate` without a specific need.
- Review with `kubectl auth can-i --list --as=system:serviceaccount:<ns>:<sa>`.

## 4. Network

Start from `assets/networkpolicy.yaml`: default-deny ingress and egress for the
namespace, then allow DNS and the specific traffic each app needs. Ingress:
TLS only, HSTS, and a WAF / rate limits in front of public services.

## 5. Helm charts

- Put the security settings above in the chart's templates with safe defaults
  in `values.yaml`; don't make "secure" an opt-in.
- Pin chart dependencies to exact versions; commit `Chart.lock`.
- Never put secrets in `values.yaml`; reference an existing Secret by name.
- Validate the rendered output, not just the templates:
  ```bash
  helm lint ./chart
  helm template ./chart -f values-prod.yaml > rendered.yaml
  kubeconform -strict -summary rendered.yaml
  kube-linter lint rendered.yaml
  trivy config --severity HIGH,CRITICAL --exit-code 1 rendered.yaml
  ```

## 6. Checks

```bash
kubeconform -strict -summary -kubernetes-version 1.37.1 k8s/
kube-linter lint k8s/
trivy config --severity HIGH,CRITICAL --exit-code 1 k8s/
```

- Use the latest Kubernetes minor your clusters run for `-kubernetes-version`,
  and check for removed APIs before upgrading clusters (`kubent` / `pluto`).
- Fix findings in the manifest. Suppress a kube-linter check only on the
  object, with a reason:
  `ignore-check.kube-linter.io/<check>: "why this is safe"`.

## Checklist

- [ ] Restricted pod security context on every pod and container
- [ ] Images pinned by digest; no `:latest`
- [ ] CPU/memory requests and memory limits set; probes defined
- [ ] Dedicated ServiceAccount, token automount off unless needed; least-privilege RBAC
- [ ] Default-deny NetworkPolicy plus explicit allows
- [ ] No plain Secrets or secret values in manifests or values files
- [ ] `kubeconform`, `kube-linter`, `trivy config` (and `helm lint`) clean
