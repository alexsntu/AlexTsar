# Сборка образа Frappe (ERPNext + vsd_fleet_ms)

Нужно один раз собрать образ `fleet-portal-erpnext:latest`, который используют
сервисы `backend`, `websocket`, `queue-*`, `scheduler`, `frontend`, `configurator`
в `docker-compose.yml`.

## 1. Получить ресурсы сборки (Containerfile) от Frappe

```bash
git clone --depth 1 --branch main https://github.com/frappe/frappe_docker.git frappe_docker
```

Уже сделано в этом проекте — папка `frappe_docker/` рядом. Не редактируйте её,
она используется только как источник `images/layered/Containerfile`.

## 2. `apps.json` — какие приложения ставим поверх Frappe

Файл `apps.json` в корне проекта:

```json
[
  { "url": "https://github.com/frappe/erpnext", "branch": "version-15" },
  { "url": "https://github.com/VVSD-LTD/vsd_fleet_ms", "branch": "master" }
]
```

Если понадобится добавить ещё одно Frappe-приложение — допишите его сюда
третьим элементом и пересоберите образ (шаг 3).

## 3. Сборка

```bash
docker build \
  --build-arg=FRAPPE_BRANCH=version-15 \
  --build-arg=FRAPPE_PATH=https://github.com/frappe/frappe \
  --secret id=apps_json,src=apps.json \
  --tag=fleet-portal-erpnext:latest \
  --file=frappe_docker/images/layered/Containerfile \
  frappe_docker
```

Сборка идёт ~2–4 минуты (на Apple Silicon, нативно под arm64, без эмуляции).
Результат — образ `fleet-portal-erpnext:latest` (~3.6 ГБ) с уже вкомпилированными
`frappe`, `erpnext` и `vsd_fleet_ms`.

Проверить:

```bash
docker images | grep fleet-portal-erpnext
```

## Когда пересобирать

- Обновили версию ERPNext или `vsd_fleet_ms` → пересобрать образ, затем
  `docker compose -p fleet up -d --no-deps backend websocket queue-short queue-long scheduler frontend configurator`
  и `docker compose -p fleet exec backend bench --site frontend migrate`.
- Добавили новое Frappe-приложение — то же самое, плюс
  `bench --site frontend install-app <имя_приложения>`.

## На VPS

VPS может быть слабее по CPU — сборка займёт больше времени, но команда та же.
Альтернатива — собрать образ локально, запушить в приватный registry
(например, `ghcr.io` или Docker Hub) и на VPS сделать `docker pull` вместо
`docker build`. Для старта одной компании локальная сборка на самом VPS
абсолютно нормальна и проще в поддержке.
