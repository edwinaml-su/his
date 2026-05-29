# k6 Performance Testing — HIS

Escenarios de performance testing para HIS Multipaís (Inversiones Avante).

## Estructura

```
infra/k6/
├── lib/
│   ├── config.js    # BASE_URL, VUs, thresholds — parametrizables via env
│   ├── auth.js      # loginSupabase() via Supabase Auth REST API
│   └── checks.js    # checkOk, checkTrpcOk, checkResponseTime, etc.
└── scenarios/
    ├── 01-smoke.js          # 1 VU x 30s
    ├── 02-auth-baseline.js  # 5 VUs x 1m — p95 < 800ms
    ├── 03-triage-queue.js   # 10 VUs x 2m
    ├── 04-bed-map-read.js   # 20 VUs x 2m
    ├── 05-bcma-validate.js  # 10 VUs x 2m — p95 < 1500ms
    └── 06-portal-paciente.js # 5 VUs x 2m
```

## Correr local

```bash
# Requiere Docker
export K6_USER_EMAIL="qa.admin@his.test"
export K6_USER_PASSWORD="TestPass123!"
export SUPABASE_URL="https://ejacvsgbewcerxtjtwto.supabase.co"
export SUPABASE_ANON_KEY="<anon_key>"

./scripts/run-k6.sh smoke
./scripts/run-k6.sh triage
BASE_URL=https://preview.vercel.app ./scripts/run-k6.sh auth
```

## Correr en CI

`Actions → Performance k6 → Run workflow` con inputs: `base_url`, `scenario`, `vus`, `duration`.

Ver runbook completo en `docs/40_perf_k6_runbook.md`.
