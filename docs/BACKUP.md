# Restore the database from a backup

Postgres is backed up on the production droplet. Restore it when the live database is corrupt or accidentally deleted.

## Where backups live

- Backups are written to `backups/` next to the API, as `worlds-YYYY-MM-DD-HHmmss.dump` (pg_dump custom-format archives).
- The daily cron entry at 02:00 runs `node dist/scripts/backup-db.js`.
- Every production deploy also takes a snapshot right before the PM2 restart.
- `DATABASE_URL` must be set for the backup to run.
- Backups older than 14 days are pruned. `BACKUP_RETENTION_DAYS` and `BACKUP_DIR` override the defaults.

## Restore

1. List the snapshots and pick the one you want.

   ```
   ls -lh backups/worlds-*.dump
   ```

2. Restore the chosen snapshot into the database. `--clean` drops existing objects first. `--if-exists` keeps the drop idempotent, so an empty database also restores cleanly.

   ```
   pg_restore --clean --if-exists -d "$DATABASE_URL" backups/worlds-YYYY-MM-DD-HHmmss.dump
   ```

## Verify the restore

Confirm the API serves data:

```
curl http://127.0.0.1:3067/health
```

## Take a manual backup

Run the backup on demand:

```
pnpm backup:db
```

The script shells out to `pg_dump`, so it is safe to run while the API is live.