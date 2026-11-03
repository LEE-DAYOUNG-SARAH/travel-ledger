# 여행 가계부 (travel-ledger)

여행별로 지출을 현지 통화로 기록하고 원화로 환산해 보여주는 반응형 웹앱.
프론트(React) + API 서버(Node/Hono)가 **서버 프로세스 1개**로 뜨고, DB는 libSQL(SQLite 호환) — 로컬 파일 또는 **Turso** 원격 DB.

- 여행 단위 가계부 (기간 · 통화 · 환율 고정 · 예산)
- Day 1 / Day 2 … 날짜 탭, 오늘 지출 · 하루 평균 · 남은 예산
- 지출 입력: 현지통화 ↔ 원화 토글, 카테고리 6종, 현금/카드, 메모/장소
- 통계: 카테고리 도넛, 결제수단 비율, 일별 막대(일 예산선)
- 백업: JSON 내려받기/복원, CSV 내려받기, 환율 재계산
- PIN 1개로 접근 제한 (환경변수)

## 요구사항

- Node.js **20 이상**

## 로컬 실행

```bash
npm install
npm run build                 # 프론트 빌드 → dist/
APP_PIN=1234 npm start        # http://localhost:3000
```

개발 중에는 두 개 띄우기:

```bash
npm run dev:server            # API (3000, PIN=1234, 파일 변경 시 자동 재시작)
npm run dev                   # Vite 개발 서버 (5173, /api 는 3000으로 프록시)
```

첫 여행(치앙마이) 자동 생성:

```bash
npm run seed                  # 여행만
npm run seed -- --demo        # 데모 지출 13건 포함 (화면 확인용)
```

## 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `APP_PIN` | (없음) | 접속 PIN. 비우면 인증 없이 열림 |
| `APP_SECRET` | `change-me-<PIN>` | 토큰 서명 키. 긴 랜덤 문자열 권장 |
| `TURSO_DATABASE_URL` | (없음) | 설정하면 Turso 원격 DB 사용 (`libsql://...turso.io`) |
| `TURSO_AUTH_TOKEN` | (없음) | Turso 토큰 |
| `DB_PATH` | `./data/ledger.sqlite` | Turso 미설정 시 로컬 SQLite 파일 경로. **볼륨/영구 디스크에 두기** |
| `PORT` | `3000` | 포트 |

## 배포

### Render (무료) + Turso (무료)  ← 현재 운영 구성

1. [Turso](https://turso.tech)에서 DB 생성 → URL(`libsql://...`)과 토큰 발급
2. Render → **New → Blueprint** → 이 레포 선택 (`render.yaml` 자동 적용)
3. 환경변수 `APP_PIN`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` 입력 → Deploy
4. 무료 인스턴스는 15분 유휴 시 잠듦 → [UptimeRobot](https://uptimerobot.com) 등으로 `/healthz`를 5분마다 호출해 깨워두기


### Docker (VPS 등)

```bash
docker build -t travel-ledger .
docker run -d --name ledger -p 3000:3000 \
  -e APP_PIN=1234 -e APP_SECRET=$(openssl rand -hex 32) \
  -v ledger-data:/data travel-ledger
```

`/data` 볼륨에 SQLite가 저장되므로 컨테이너를 지워도 데이터는 남습니다.

### Railway / Fly.io / Render

- Dockerfile을 자동 인식합니다.
- 환경변수 `APP_PIN`, `APP_SECRET` 설정.
- **영구 디스크(volume)를 `/data`에 마운트**하세요. 안 하면 재배포 때 DB가 초기화됩니다.
  - Railway: Volume 추가 → mount path `/data`
  - Fly: `fly volumes create ledger_data` 후 `fly.toml`에 `[mounts] source="ledger_data" destination="/data"`

### 그냥 Node로 (pm2 등)

```bash
npm ci && npm run build
APP_PIN=1234 APP_SECRET=... DB_PATH=/var/lib/ledger/ledger.sqlite PORT=3000 npm start
```

HTTPS는 Caddy/nginx 등 리버스 프록시 뒤에 두면 됩니다. (PIN이 평문으로 전송되므로 HTTPS 권장)

## 백업

- 앱 설정 화면에서 JSON 내려받기 → 복원 가능.
- 서버에서 직접: `DB_PATH` 파일(+ `-wal`, `-shm`) 복사. 또는 `sqlite3 ledger.sqlite ".backup backup.sqlite"`.

## API 요약

```
POST /api/auth/login            {pin} → {token}       Authorization: Bearer <token>
GET  /api/trips                 목록(+totalBase, expenseCount)
POST /api/trips | PUT /api/trips/:id | DELETE /api/trips/:id
POST /api/trips/:id/recalc      현재 환율로 지출 전체 재계산
GET  /api/trips/:id/expenses
POST /api/expenses | PUT /api/expenses/:id | DELETE /api/expenses/:id
GET  /api/export | POST /api/import?replace=0|1
GET  /api/rate?from=THB&to=KRW  (open.er-api.com 프록시)
```

## 구조

```
server/   index.js(API+정적 서빙)  db.js(SQLite)  seed.js
src/      pages/ components/ store/(zustand) lib/(api, router, format) types.ts
dist/     npm run build 산출물 (서버가 서빙)
```

## 다음 단계 아이디어

동행인 정산(N빵), 영수증 사진, 일정 연동, 로그인/멀티유저, Spring Boot 백엔드로 교체.
