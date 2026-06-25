# Kubernetes Manifests — HIS Multipaís (opción self-hosted)

**Estado:** Listo para aplicar. No activo en MVP (se usa Vercel + Supabase managed). Esta ruta es para clientes que requieran on-premise o cloud privado.

---

## Pre-requisitos del cluster

| Componente | Versión min | Notas |
|---|---|---|
| Kubernetes | 1.28+ | EKS, GKE, AKS, RKE2 o bare metal |
| ingress-nginx | 1.10+ | `kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.10.0/deploy/static/provider/aws/deploy.yaml` |
| cert-manager | 1.14+ | `kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.0/cert-manager.yaml` |
| metrics-server | 0.7+ | Requerido por HPA |

---

## Estructura

```
infra/k8s/
├── base/                    Recursos base (todos los ambientes)
│   ├── namespace.yaml
│   ├── deployment-web.yaml  Next.js, 3 réplicas, liveness/readiness
│   ├── service-web.yaml     ClusterIP port 80
│   ├── ingress.yaml         nginx + cert-manager TLS
│   ├── hpa.yaml             CPU 70%, mem 80%, min 3 / max 10
│   ├── configmap.yaml       Feature flags non-sensitive
│   ├── secret-template.yaml PLANTILLA — reemplazar antes de aplicar
│   └── kustomization.yaml
└── overlays/
    ├── staging/             2 réplicas, dominio staging, env=staging
    │   └── kustomization.yaml
    └── prod/                3 réplicas, PDB min 2, dominio prod
        ├── kustomization.yaml
        └── pdb.yaml
```

---

## Comandos principales

```bash
# Ver qué se va a aplicar (dry-run)
kubectl apply -k infra/k8s/overlays/prod --dry-run=client

# Aplicar producción
kubectl apply -k infra/k8s/overlays/prod

# Aplicar staging
kubectl apply -k infra/k8s/overlays/staging

# Ver estado de pods
kubectl get pods -n his-avante

# Ver logs en tiempo real
kubectl logs -n his-avante -l app.kubernetes.io/name=his-web -f --tail=100

# Forzar rolling restart (nueva imagen mismo tag)
kubectl rollout restart deployment/his-web -n his-avante

# Status del deploy
kubectl rollout status deployment/his-web -n his-avante
```

---

## Gestión de secrets

**NUNCA** aplicar `secret-template.yaml` con valores PLACEHOLDER en producción.

Opciones recomendadas (en orden de preferencia):

1. **External Secrets Operator (ESO)** con AWS Secrets Manager:
   ```bash
   helm repo add external-secrets https://charts.external-secrets.io
   helm install external-secrets external-secrets/external-secrets -n external-secrets --create-namespace
   # Luego crear ExternalSecret que lee de AWS Secrets Manager
   ```

2. **Sealed Secrets** (cifrado en git):
   ```bash
   kubeseal --format=yaml < secret-template.yaml > sealed-secret.yaml
   # sealed-secret.yaml SÍ se puede commitear
   ```

3. **Manual** (solo dev/staging):
   ```bash
   kubectl create secret generic his-web-secrets \
     --from-env-file=.env.k8s \
     -n his-avante \
     --dry-run=client -o yaml | kubectl apply -f -
   ```

---

## Imagen Docker

La imagen se construye y publica automáticamente vía
`.github/workflows/release-image.yml` (push a `main` → `:latest` + `:sha-…`;
tags `v*` → semver) en GHCR usando `GITHUB_TOKEN` (sin PAT).

Build manual desde la raíz del monorepo (los `NEXT_PUBLIC_*` se inlinean en build):

```bash
docker build -f Dockerfile \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://<proj>.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key-publico> \
  --build-arg APP_VERSION=$(git rev-parse --short HEAD) \
  -t ghcr.io/edwinaml-su/his-web:$(git rev-parse --short HEAD) .
docker push ghcr.io/edwinaml-su/his-web:$(git rev-parse --short HEAD)
```

En producción actualizar el tag en el Deployment o usar Flux ImageUpdateAutomation / ArgoCD Image Updater.

---

## SLOs aplicados a K8s

| SLO | Mecanismo K8s |
|---|---|
| 99.5% uptime | 3 réplicas + PDB minAvailable:2 + topologySpreadConstraints |
| RTO ≤ 4h | Rolling update (maxUnavailable:0) + readiness probe (no tráfico hasta listo) |
| p95 < 800ms | HPA escala antes de saturar — umbral 70% CPU |
| Graceful shutdown | terminationGracePeriodSeconds: 30 |
