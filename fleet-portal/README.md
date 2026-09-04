# Портал автопарка (рефрижераторы)

Локальный стенд, который переезжает на VPS без переделки: логистика/грузы на
ERPNext + `vsd_fleet_ms`, учёт ТО/ремонтов/топлива на LubeLogger, всё за одной
стартовой страницей.

## Состав стека

| Сервис | Что это | Локальный адрес |
|---|---|---|
| **Портал** | Стартовая страница со ссылками | http://localhost:8888 |
| **ERPNext + vsd_fleet_ms** | Рейсы, грузы, тягачи/прицепы/водители, топливо, техосмотры, ТТН/акты, бухгалтерия | http://localhost:8000 |
| **LubeLogger** | История ремонтов и ТО, топливо и расход, напоминания по пробегу/датам | http://localhost:8181 |

Служебные (без прямого доступа снаружи): MariaDB, Redis (cache/queue), Frappe
websocket/queue/scheduler-воркеры.

## Быстрый старт (уже сделано на этом Маке)

```bash
cd fleet-portal
docker compose -p fleet up -d      # поднять всё
docker compose -p fleet ps         # проверить статусы
docker compose -p fleet down       # остановить (данные сохраняются в volume)
docker compose -p fleet down -v    # остановить И стереть все данные (осторожно)
```

Если Docker не запущен: `colima start` (один раз после перезагрузки Мака).

Образ `fleet-portal-erpnext:latest` собран локально — см. [`BUILD.md`](BUILD.md),
там же инструкция, как пересобрать при обновлении версий или добавлении
нового Frappe-приложения.

## Доступы

- **ERPNext**: логин `Administrator`, пароль — значение `ADMIN_PASSWORD` из `.env`.
- **LubeLogger**: при первом заходе на http://localhost:8181 попросит создать
  учётную запись администратора — это нормально, приложение свежее.
- Пароли лежат в `.env` (файл не коммитится в git, см. `.gitignore`).

## Первые шаги в ERPNext

1. Войдите как `Administrator`.
2. Пройдите Setup Wizard (название компании, страна, валюта — RUB, часовой пояс).
3. В левом меню найдите модуль **Transport** (это и есть `vsd_fleet_ms`) —
   там уже есть DocType'ы под вашу задачу: `Truck`, `Trailers`, `Truck Driver`,
   `Trips`, `Round Trip`, `Transportation Order`, `Manifest`, `Fuel Requests`,
   `Truck Inspections Template` и т.д.
4. Заведите справочники: типы кузова/груза, тягачи и прицепы (можно сразу
   пометить, что это рефрижератор — либо через custom field на `Truck`, либо
   через отдельный `Truck Type`), водителей, маршруты.
5. Печатные формы ТТН и «Акт выполненных работ» — через **Print Format**
   (Setup → Printing → Print Format, HTML/Jinja). Готовых российских шаблонов
   в модуле нет, их нужно сверстать один раз под ваши реквизиты — дальше они
   будут генерироваться автоматически из данных рейса/груза. Могу помочь с
   этим отдельным шагом, когда дойдёте до документов.

## Первые шаги в LubeLogger

1. Создайте пользователя-администратора при первом входе.
2. Добавьте машины (Garage → Add Vehicle) — по одной на каждый рефрижератор,
   с VIN/госномером.
3. Настройте Maintenance Schedules — интервалы ТО по пробегу/времени, для
   рефрижераторов не забудьте добавить отдельные пункты на **холодильную
   установку** (агрегат), а не только на шасси/двигатель.
4. Начните логировать топливо и ремонты — оттуда же будут приходить
   напоминания.

> Важно: ERPNext/vsd_fleet_ms и LubeLogger — это две независимые системы со
> своими базами и логинами (портал просто даёт единую точку входа, это не
> SSO). Если со временем это будет мешать — можно добавить единый вход
> (Keycloak/Authelia) отдельным шагом.

## Перенос на VPS

1. **Арендуйте VPS**: минимум 2 vCPU / 4 ГБ RAM (лучше 4 vCPU / 8 ГБ, если
   парк вырастет) с чистым Ubuntu 22.04/24.04, установите Docker Engine +
   Docker Compose plugin (`curl -fsSL https://get.docker.com | sh`).
2. **Скопируйте проект** на VPS (`git clone` вашего репозитория, либо `rsync`
   папки `fleet-portal`, без `frappe_docker/` — его достаточно склонировать
   заново там же командой из `BUILD.md`).
3. **Пересоберите образ на VPS** (команда из `BUILD.md`) — так вы не зависите
   от приватного реестра образов.
4. **DNS**: заведите поддомены на IP VPS — `example.ru`, `erp.example.ru`,
   `garage.example.ru`.
5. **В `.env` добавьте**:
   ```
   DOMAIN=example.ru
   ACME_EMAIL=you@example.ru
   ```
6. **Смените пароли** в `.env` (`ADMIN_PASSWORD`, `DB_ROOT_PASSWORD`) на новые,
   продовые — это должны быть новые значения, не те, что использовались локально.
7. **Запуск с HTTPS через Traefik** (оверлей уже готов):
   ```bash
   docker compose -p fleet -f docker-compose.yml -f docker-compose.vps.yml up -d
   ```
   Traefik сам получит сертификаты Let's Encrypt для всех трёх доменов.
8. **Firewall**: откройте только 80/443 (и 22 для SSH) —
   `ufw allow 80,443,22/tcp && ufw enable`.
9. **Бэкапы** (важно настроить сразу):
   - ERPNext: `docker compose -p fleet exec backend bench --site frontend backup --with-files`
     — складывает дамп БД и файлы в `sites/frontend/private/backups`; повесьте
     это на cron раз в сутки и копируйте наружу (например, в S3-совместимое
     хранилище или на другой сервер).
   - LubeLogger: бэкапить volume `fleet_lubelogger-data` (там SQLite-база и
     вложения), например `docker run --rm -v fleet_lubelogger-data:/data -v $PWD:/backup alpine tar czf /backup/lubelogger-$(date +%F).tar.gz /data`.
   - MariaDB: том `fleet_mariadb-data` бэкапится вместе с `bench backup`
     (использует mysqldump под капотом), отдельно можно не бэкапить.

## Структура проекта

```
fleet-portal/
├── docker-compose.yml       # основной стек (локально и на VPS)
├── docker-compose.vps.yml   # + Traefik/HTTPS для VPS (оверлей)
├── apps.json                 # какие Frappe-приложения вкомпилированы в образ
├── .env                      # пароли и порты (не коммитить)
├── BUILD.md                  # как собрать/пересобрать образ ERPNext
├── portal/
│   └── index.html             # стартовая страница
└── frappe_docker/             # клон frappe/frappe_docker — только для сборки образа
```
