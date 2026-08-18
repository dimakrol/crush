# monitoring

Базовый стек наблюдаемости для crush: **Prometheus + Grafana + Loki**.
Живёт в отдельном Compose-проекте (`crush-monitoring`) и приклеивается к сети
app-стека `crush_default`. См. `../plan_monitoring.md` — источник правды по решениям.

## Что собирается

| Слой | Инструмент | Покрытие |
|---|---|---|
| Контейнеры | cAdvisor | CPU/RAM/сеть/рестарты каждого контейнера (все сервисы) |
| Хост | node-exporter | диск / память / load |
| Postgres | postgres_exporter | соединения, запросы, локи, размер БД |
| Redis | redis_exporter | память, hit-rate, соединения |
| Логи | Grafana Alloy → Loki | stdout всех контейнеров (JSON), метки `service`/`container`/`host` + `level` |

Retention: метрики **15 дней** (Prometheus TSDB), логи **15 дней** (Loki filesystem).

## Запуск

Порядок важен: app-стек создаёт сеть `crush_default`, к которой цепляется мониторинг.

```bash
# 1. из корня репозитория — поднять продукт (создаёт сеть crush_default)
docker compose up -d

# 2. настроить креды мониторинга
cd monitoring
cp .env.example .env      # отредактировать GRAFANA_ADMIN_PASSWORD и пр.

# 3. поднять мониторинг
docker compose --env-file .env up -d
```

### Хостовые экспортеры (cAdvisor + node-exporter)

Оба читают ядро/rootfs хоста напрямую и осмысленны только на реальном Linux-хосте.
На Docker Desktop (Mac/Windows) они мерили бы LinuxKit-VM, а `rslave`-маунт
node-exporter там вообще падает (`path / ... is not a shared or slave mount`).
Поэтому они спрятаны за профиль `host-metrics`:

```bash
# локально (Mac): плейн up — экспортеры пропускаются, всё остальное поднимается
docker compose --env-file .env up -d

# на сервере (Linux): включить профиль
docker compose --env-file .env --profile host-metrics up -d
# либо один раз прописать в серверном .env:  COMPOSE_PROFILES=host-metrics
```

Локально джобы `cadvisor` и `node-exporter` в Prometheus будут числиться `DOWN`,
а дашборды Node/cAdvisor — пустыми. Это ожидаемо.

## Доступ к Grafana

Grafana слушает только `127.0.0.1:3000` — наружу ничего не торчит. С локальной
машины:

```bash
ssh -L 3000:localhost:3000 <server>
# затем открыть http://localhost:3000 (логин из .env)
```

Datasource'ы (Prometheus + Loki) и дашборды (Node Exporter Full, cAdvisor,
Postgres, Redis) провижёнятся автоматически при старте.

## Полезное

```bash
# статус
docker compose -f monitoring/docker-compose.yml ps

# логи в Grafana Explore (LogQL):
#   {service="backend"} | json | level="error"
#   {service=~"backend|white-label|backoffice"} | json

# перечитать конфиг Prometheus без рестарта (включён --web.enable-lifecycle):
docker compose -f monitoring/docker-compose.yml exec prometheus \
  wget -qO- --post-data='' http://localhost:9090/-/reload
```

## Вне scope (следующие фазы)

- Прикладные `/metrics` в Nest-сервисах (`prom-client`, RED + бизнес-метрики).
- Алертинг (Alertmanager / встроенный алертинг Grafana + канал уведомлений).
- Браузерный RUM фронтенда (Grafana Faro).
