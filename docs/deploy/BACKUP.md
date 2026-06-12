# Postgres Backup + Restore — FB_EVENTOS

**Plan 07, Phase 0 — FOUND-12. PITR + verification drill + LGPD retention cross-ref.**

> **RESEARCH Open Question #3 / Assumption A6 (LOW confidence pre-deploy):**
> Coolify's actual managed-Postgres backup tier needs to be verified on
> first deploy. If Coolify only supports snapshot-based backups (not true
> PITR), the `pg_dump → MinIO` supplement below provides the ≥7-day
> retention guarantee that FOUND-12 requires.

---

## Section 1 — Target

**Point-In-Time Recovery (PITR) retention ≥ 7 days.**

For FB_EVENTOS piloto (Festa de Trindade, ~900k attendees), an outage
window of more than 24 hours is unrecoverable from a reputation
standpoint. The 7-day PITR window covers:

- Friday-night deploy regression discovered Monday morning.
- Holiday-weekend incident where on-call response is slow.
- Schema-migration mistake discovered after multiple weekday deploys.

---

## Section 2 — Coolify Managed Postgres Backup

### 2.1 Enable in Coolify UI

1. Coolify dashboard → `fb-eventos-postgres` → "Backups" tab.
2. Enable backup with the following settings:
   - **Schedule:** every 6 hours (minimum).
   - **Retention:** 7 days (minimum). Phase 1+ may extend to 30 days.
   - **Destination:** S3-compatible (MinIO target — see Section 4).
3. Save. Coolify schedules `pg_dump` runs against the managed cluster.

### 2.2 Verify backup tier capability

After enabling, click "Backup Now" once and inspect the resulting file.
Verify it is:
- A `pg_dump --format=custom` dump (NOT a filesystem snapshot).
- Restorable with `pg_restore` on a clean Postgres instance.

If Coolify's backup tier produces only filesystem snapshots (not true
pg_dump output), proceed to Section 3 (pg_dump supplement).

### 2.3 Verify retention

24 hours after the first backup, confirm `≥4` backup files exist
(6-hour schedule × 4 = ≥1 day; extrapolate to 7 days as data accumulates).

---

## Section 3 — pg_dump → MinIO Supplement

If Coolify's managed backup tier does not meet ≥7-day PITR, ship a
sidecar cron job that runs `pg_dump` directly to MinIO.

### 3.1 Cron job template

Run from a separate Coolify "Scheduled Task" service (Coolify exposes
cron-style scheduled commands):

```bash
#!/usr/bin/env bash
# scripts/ops/pg-backup-to-minio.sh
set -euo pipefail

TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
BACKUP_DIR=$(mktemp -d)
trap "rm -rf $BACKUP_DIR" EXIT

DUMP_FILE="$BACKUP_DIR/fb-eventos-${TIMESTAMP}.dump"

# 1. Dump (uses superuser conn URL — set in Coolify env).
pg_dump --format=custom \
        --no-owner \
        --no-acl \
        --file="$DUMP_FILE" \
        "$PG_BACKUP_URL"

# 2. Compress + upload to MinIO.
gzip "$DUMP_FILE"
mc cp "$DUMP_FILE.gz" "fb-eventos/backups/postgres/"

# 3. Prune backups older than 7 days.
mc rm --recursive --force --older-than 7d \
   "fb-eventos/backups/postgres/"

echo "backup-to-minio: OK ${TIMESTAMP}"
```

### 3.2 Schedule

In Coolify "Scheduled Tasks":

```
Cron schedule:     0 */6 * * *      (every 6 hours)
Command:           bash /app/scripts/ops/pg-backup-to-minio.sh
Container:         alpine:3.20 with postgresql-client + mc (MinIO CLI)
Env vars:
  PG_BACKUP_URL    postgresql://{{COOLIFY_PG_SUPERUSER}}:{{COOLIFY_PG_SUPERUSER_PW}}@{{COOLIFY_PG_HOST}}:5432/fb_eventos
  MC_HOST_fbeventos s3+http://{{MINIO_ACCESS_KEY}}:{{MINIO_SECRET_KEY}}@minio-internal:9000
```

### 3.3 Caveats

- This supplement is NOT true PITR — it's point-in-time-snapshot-every-6h.
  True PITR requires WAL archiving (Postgres `archive_mode=on` +
  `archive_command`). Coolify's managed Postgres may not expose
  `postgresql.conf` for `archive_mode`; if it does, configure WAL
  archiving to MinIO and use `pg_basebackup` weekly + WAL replay for
  arbitrary-point recovery.
- The 6-hour gap is the maximum data loss window for piloto Phase 0.
  Phase 1 may need to tighten this (e.g. 1-hour gap) for ticket-sales
  reliability.

---

## Section 4 — Restore Procedure

### 4.1 Identify the target restore point

```bash
# List available backups.
mc ls fb-eventos/backups/postgres/
# Example output:
#   2026-06-12T180000Z  4.2MiB  fb-eventos-20260612T180000Z.dump.gz
#   2026-06-12T120000Z  4.1MiB  fb-eventos-20260612T120000Z.dump.gz
#   ...
```

Pick the backup file just BEFORE the incident timestamp.

### 4.2 Provision a separate Postgres for the restore

```bash
# Inside the Coolify host (or your local machine with Docker):
docker run -d --name fb-restore-target \
  -e POSTGRES_USER=restore \
  -e POSTGRES_PASSWORD=restore \
  -e POSTGRES_DB=fb_eventos_restore \
  -p 5433:5432 \
  postgres:16-alpine
```

> NEVER restore directly to the production Postgres without first
> verifying the dump is intact. Use a separate target.

### 4.3 Download + restore

```bash
mc cp fb-eventos/backups/postgres/fb-eventos-20260612T120000Z.dump.gz .
gunzip fb-eventos-20260612T120000Z.dump.gz

pg_restore --clean --if-exists --no-owner --no-acl \
  --dbname=postgresql://restore:restore@localhost:5433/fb_eventos_restore \
  fb-eventos-20260612T120000Z.dump
```

### 4.4 Verify

```bash
# 1. Schema present
psql postgresql://restore:restore@localhost:5433/fb_eventos_restore \
  -c "\dt"
# Expect: tenants, user, session, organization, member, invitation,
#         audit_log, consent_records, etc.

# 2. Data present
psql postgresql://restore:restore@localhost:5433/fb_eventos_restore \
  -c "SELECT count(*) FROM tenants; SELECT count(*) FROM \"user\";"

# 3. Run the walking-skeleton against the restored DB
PLAYWRIGHT_BASE_URL=http://restored-host:3000 pnpm test:e2e
```

### 4.5 Cut over to the restored DB

Once verified:

1. Coolify dashboard → put production Postgres in maintenance mode.
2. Backup the current (corrupt) production DB one more time (in case the
   restore is wrong).
3. Restore the verified dump to production's Postgres (use Coolify's
   "Restore from Backup" UI if available, else `pg_restore` directly).
4. Restart the web + worker services.
5. Run the verification SQL from
   `docker/coolify/postgres.service.md` "Verification SQL".

---

## Section 5 — Verification Drill (Monthly)

**Required cadence:** monthly. Drill is the only way to know the backup
tier actually works.

### 5.1 Drill procedure

1. Pick the most recent backup file from MinIO.
2. Restore to a fresh Postgres-16-alpine container (Section 4.2-4.3).
3. Run the walking-skeleton spec against the restored DB
   (Section 4.4 step 3).
4. Verify the spec passes AND the `audit_log` table has at least one
   row from the restored data.
5. Tear down the restore container.

### 5.2 Drill log

Record each drill in `docs/incidents/drill-log.md`:

```
| Date       | Backup file                          | Result | Notes                       |
| ---------- | ------------------------------------ | ------ | --------------------------- |
| 2026-07-12 | fb-eventos-20260712T060000Z.dump.gz  | PASS   | Restore in 4 min; E2E green |
| 2026-08-12 | fb-eventos-20260812T060000Z.dump.gz  | PASS   | Restore in 5 min; E2E green |
```

> A drill that fails is a P1 incident — pause feature work until backup
> tier is fixed.

---

## Section 6 — LGPD Retention Cross-Reference

LGPD Art. 16 mandates that personal data must not be retained beyond
the purpose for which it was collected. Backups containing PII MUST be
purged at the longest retention window of any included table.

See `docs/LGPD.md` retention table (Plan 05):

| Table             | PII retention            | Backup implication                            |
| ----------------- | ------------------------ | --------------------------------------------- |
| `user`            | Until account deletion + 30d anonymization grace | Backups older than 30 days post-deletion must be purged |
| `audit_log`       | 7 years (regulatory)     | Backups must be retained 7 years for audit, but PII columns inside must be anonymized after 30 days post-user-deletion |
| `consent_records` | 5 years (LGPD Art. 8 §1°)| Backups retained 5 years; older purged        |

**Phase 0 simplification:** the ≥7-day backup window does not yet
intersect any LGPD retention boundary. Phase 4 LGPD-07 implements the
anonymize-after-retention worker that scrubs PII from `audit_log`
before backups are eligible for long-term archival.

---

## Section 7 — Disaster Recovery RTO/RPO

For piloto Phase 0:

| Metric | Target          | Mitigation                                                                              |
| ------ | --------------- | --------------------------------------------------------------------------------------- |
| RTO    | 4 hours         | Coolify managed Postgres backup tier + Section 4 procedure                              |
| RPO    | 6 hours         | Section 3 pg_dump→MinIO every 6h. Tighten to 1h in Phase 1.                            |

Phase 1+ may move to streaming replication + WAL archiving for sub-minute RPO.

---

## See Also

- `docs/RUNBOOK.md` — incident response (when to restore).
- `docs/deploy/COOLIFY.md` — deploy procedure.
- `docs/LGPD.md` — retention table.
- `docker/coolify/postgres.service.md` — managed Postgres config.
