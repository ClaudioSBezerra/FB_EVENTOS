# Deploy status — 2026-06-16 ~03:00

## Pra ler de manhã antes de redeploy

**Último commit em main:** `54e6000` — `fix(deploy): migrations + graphile-worker bootstrap + RLS policy install`

## O que rodou bem no último deploy

✓ Custom Postgres image carregou os init scripts (`01-roles.sh` + `02-extensions.sh`)
✓ Database `fb_eventos_dev` criada
✓ Roles `fb_app_user`, `fb_migrator`, `fb_eventos_sysreader` criados
✓ Extensions `pgcrypto` + `pg_trgm` instaladas

Log Postgres:
```
[01-roles.sh] OK — roles created, db fb_eventos_dev ready
[02-extensions.sh] OK
```

## O que ainda quebrou

Worker conectou como `fb_app_user`, mas graphile-worker.run() tentou
`CREATE SCHEMA graphile_worker` → **permission denied** (fb_app_user
não tinha CREATE no database). E também, **migrations nunca rodaram**
em nenhum deploy desta sessão — não tinha mecanismo wired.

## Os 3 fixes em `54e6000`

1. **scripts/db/init/01-roles.sh** — adicionado
   `GRANT CREATE ON DATABASE fb_eventos_dev TO fb_eventos_app`. Mantém
   `fb_eventos_app NOBYPASSRLS` (contrato de RLS intacto), só permite
   que ele crie o próprio schema da fila do graphile-worker.

2. **docker-compose.yml** — novo service `migrate` que roda
   `tsx src/db/migrate.ts` antes de web e worker. Roda uma vez e sai
   (`restart: "no"`). web e worker têm
   `depends_on: migrate { condition: service_completed_successfully }`,
   então só sobem depois das migrations terminarem.

3. **src/jobs/runner.ts** — implementa o `install_graphile_worker_policies`
   que o comment header de migration 0009 prometeu mas nunca foi escrito.
   Novo flow:
   - **Step 1**: one-shot `graphile-worker.run()` com `DATABASE_MIGRATOR_URL`
     (BYPASSRLS) só pra fazer o bootstrap do schema com privilégios elevados,
     stop imediato.
   - **Step 2**: `SELECT fb_install_graphile_worker_policies()` via
     migratorPool, anexa a policy `fb_eventos_app_full_access` em todas as
     tables `graphile_worker.*`.
   - **Step 3**: começa o runner real como `fb_app_user` (NOBYPASSRLS).

Volume Postgres bumpado pra `postgres_data_v4` pra forçar fresh init com
o `GRANT CREATE` novo.

## Pra fazer no Coolify

**Só clica Redeploy.** Não precisa deletar volume manualmente — o rename
para `v4` força Coolify a criar volume novo.

## Sequência esperada de containers

1. `postgres` sobe → init scripts rodam → fb_app_user com CREATE granted ✓
2. `migrate` (one-shot) sobe → roda 0001..0020 → exit 0
3. `minio` sobe → healthy
4. `web` sobe → Next.js ready, healthcheck `/api/health` retorna 200
5. `worker` sobe →
   - bootstrap schema graphile_worker (via migrator) ✓
   - install RLS policies ✓
   - start real runner (fb_app_user) — não crash desta vez ✓

## Se ainda quebrar

Manda o log do container que falhou (Coolify → service → Logs, não Deployments).
Categorias possíveis:
- Worker ainda crashing → provavelmente env DATABASE_MIGRATOR_URL não chegou
- migrate exit code != 0 → log do migrate mostra qual migration quebrou
- web sem responder → log do web na hora da migration

## Status Git

main em commit `54e6000`, branch sincronizada com `origin/main`.
Working tree limpo. 16 commits empurrados nesta sessão.
