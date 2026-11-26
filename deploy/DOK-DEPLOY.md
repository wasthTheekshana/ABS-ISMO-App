# ISOMS on the DOK shared server

Server: application-docker-server, 34.93.171.14. Stack folder: ~/isoms-stack.
Domain: ismo.testsys.shop (set as ISOMS_DOMAIN in .env). Commands are plain ASCII, one per line.

## What runs

| Container | Image | Role | Reached by |
|-----------|-------|------|------------|
| isoms-db | postgres:16-alpine | database, data in /mnt/disks/data/db/isoms | isoms-api only (private network) |
| isoms-migrate | isoms-api | one-shot: creates or updates the tables, then exits | runs at every start |
| isoms-api | built from deploy/Dockerfile.api | the REST API on port 5010 | shared Nginx at /api/ |
| isoms-web | built from deploy/Dockerfile.web | the web app on port 8080 | shared Nginx at / |

Limits: db 1 CPU / 2 GB, api 1 CPU / 1 GB, web 0.5 CPU / 256 MB, migrate 0.5 CPU / 512 MB (only while it runs).
Nothing is published on a host port. Only the shared Nginx (80 and 443) is public.

## First deployment

### 1. DNS

Add an A record for ismo.testsys.shop pointing to 34.93.171.14, then check it:

```
nslookup ismo.testsys.shop
```

### 2. Get the code

The repository is private, so the server needs a deploy key or a token for it.

```
git clone https://github.com/wasthTheekshana/ABS-ISMO-App.git ~/isoms-stack
cd ~/isoms-stack
```

### 3. Settings

```
cp deploy/.env.production.example .env
chmod 600 .env
nano .env
```

Fill in every value. Make NEW secrets for this server:

```
openssl rand -base64 24
openssl rand -base64 48
```

The first is for POSTGRES_PASSWORD, the second for JWT_SECRET. Do not reuse the example JWT secret
from the development .env.example: it is in the repository history, so anyone who has seen it could forge a sign-in.

### 4. Data folder

Confirm the data disk is mounted before anything starts, otherwise Postgres would silently use the boot disk:

```
findmnt /mnt/disks/data
grep disks/data /etc/fstab
sudo mkdir -p /mnt/disks/data/db/isoms
sudo chown -R 70:70 /mnt/disks/data/db/isoms
df -h /mnt/disks/data
```

uid 70 is the postgres user in the alpine image. Never chmod 777.

### 5. Build and start

```
cd ~/isoms-stack
docker compose -f deploy/docker-compose.yml --env-file .env up -d --build
docker compose -f deploy/docker-compose.yml --env-file .env ps
docker stats --no-stream
```

Expect isoms-db, isoms-api and isoms-web healthy and isoms-migrate exited with code 0.
Check what the migration did:

```
docker logs isoms-migrate
```

### 6. First account

A new database has the tables but no people, so nobody can sign in yet. Create the real first account.
It prints a one-time passcode once; give it to the person privately. They must choose their own at first sign-in.

```
docker exec isoms-api node server/db/create-user.js --epf EPF-100 --name "Full Name" --role MD --title "Managing Director" --region "All Sri Lanka" --sector "All Sectors"
```

Do NOT run npm run db:seed on this server. It loads demo accounts that all share the passcode passcode123.
More accounts: a guard needs --site SITE-ID and a client needs --sites SITE-ID,SITE-ID. Sites themselves still have to be loaded.

### 7. Certificate

```
docker run --rm -it -v ~/dok-stack/certbot/conf:/etc/letsencrypt -v ~/dok-stack/certbot/www:/var/www/certbot certbot/certbot certonly --manual --preferred-challenges dns --email wasath@doksolutions.lk --agree-tos --no-eff-email -d ismo.testsys.shop
```

Add the TXT record, check it on 8.8.8.8, 1.1.1.1 and 9.9.9.9, wait about 10 minutes, then press Enter.
Check the real folder name under live/ before using it. Set a reminder: the certificate expires in 90 days.

### 8. Nginx

Paste the two server blocks from deploy/nginx-isoms.conf into ~/dok-stack/nginx/nginx.conf, before the default catch-all.
Then:

```
cd ~/dok-stack
docker compose exec nginx nginx -t
docker compose exec nginx nginx -s reload
```

### 9. Check it

```
curl -I https://ismo.testsys.shop/
curl https://ismo.testsys.shop/api/health
curl -I https://ismo.testsys.shop/api/docs/
docker ps --format '{{.Names}} {{.Ports}}' | grep 0.0.0.0
```

The last command must list only nginx on 80 and 443. Then open https://ismo.testsys.shop/ and sign in with the first account.

The API documentation (Swagger) is at https://ismo.testsys.shop/api/docs and the raw file at /api/openapi.json. It describes the API but shows no data, and every call in it still needs a sign-in token. To switch it off, add DOCS_ENABLED=false to .env and recreate the api container.

### 10. Backups and monitoring

The nightly script ~/scripts/backup-dbs.sh dumps every running Postgres container that has POSTGRES_USER, so isoms-db is included.
Confirm after the next run, and test one restore:

```
ls -la /mnt/disks/data/backups/db/isoms-db/
```

Add an Uptime Kuma monitor for https://ismo.testsys.shop/api/health.

### 11. The phone app

The app must point at the real address, and it needs HTTPS. Rebuild it:

```
flutter build apk --release --target-platform android-arm64 --dart-define=API_BASE_URL=https://ismo.testsys.shop/api
```

## Updating after a push to main

```
cd ~/isoms-stack
git pull origin main
docker compose -f deploy/docker-compose.yml --env-file .env up -d --build
docker compose -f deploy/docker-compose.yml --env-file .env ps
docker logs --tail=50 isoms-api
docker logs isoms-migrate
```

The migration runs again on every start. It is safe to repeat: it only adds what is missing.
After an update that recreated the containers, reload Nginx if you get a 502:

```
cd ~/dok-stack
docker compose exec -T nginx nginx -s reload
```

## Checked locally before this was written

The two images build, the stack starts with the database healthy, the migration applies the schema and exits,
the API and web containers are healthy and run as non-root users, the first-account command works and its one-time
passcode forces a change, 12 different clients are not locked out together (TRUST_PROXY), and the web container
serves the app with the right caching and security headers.

Not checked, because it needs the real server: the data-disk bind mount and its ownership, the certificate,
the shared Nginx, the firewall and the real domain.
