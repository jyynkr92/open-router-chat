# OpenRouter Chat

탭을 닫아도 답변 생성이 이어지는 스트리밍 LLM 채팅 앱입니다.

브라우저는 생성 요청만 등록합니다. 실제 OpenRouter 호출은 별도 Node worker가 맡고, 받은 토큰은 PostgreSQL에 이벤트로 쌓입니다. 그래서 새로고침하거나 다른 채팅으로 갔다 돌아와도, 마지막으로 받은 이벤트 번호(`event_seq`) 다음부터 SSE로 이어 받을 수 있습니다.

## Highlights

- **이어 받는 스트리밍**: 연결이 끊기면 구독만 해제되고 생성은 계속됩니다. 다시 접속하면 저장된 이벤트부터 이어 받고, 중복이나 누락은 걸러냅니다.
- **응답 상태 관리**: `pending`, `streaming`, `completed`, `failed`, `interrupted` 상태를 나눠 관리합니다. 중단하면 그때까지 받은 답변을 저장하고, 재시도·다시 생성도 지원합니다.
- **채팅 이름 자동 생성**: 첫 질문을 요약해 이름을 붙입니다. 직접 바꾼 이름은 덮어쓰지 않습니다.
- **Markdown 답변**: GFM 표·코드 블록·인용문을 렌더링합니다. raw HTML과 이미지는 막고, 원문 복사를 지원합니다.
- **Worker 복구**: lease와 heartbeat로 오래 멈춘 생성 작업을 감지해 정리합니다.
- **UI**: 라이트/다크 테마, 키보드 탐색, IME 입력 보호, 하단 자동 스크롤을 지원합니다.

## Tech Stack

| 영역 | 사용 기술 |
| --- | --- |
| Web | Next.js 16 (App Router), React 19, TypeScript |
| State | TanStack Query (서버 데이터), Zustand (진행 중 생성·선택 채팅) |
| UI | Tailwind CSS 4, shadcn/ui, lucide-react, next-intl |
| Data | PostgreSQL 18, Prisma 7 |
| LLM | OpenRouter (`openai/gpt-4o-mini`) |
| Tooling | pnpm, Biome, Vitest, Playwright |

## Architecture

```text
Browser
  ├─ POST /api/chat/generations           ← 생성 요청 등록
  └─ GET  /api/generations/:id/events     ← snapshot + SSE 재생/구독
          │
          ▼
Next.js Route Handlers ──── PostgreSQL ────┐
                                           │ claim · lease · heartbeat
                              Node worker ─┘
                                   └─ OpenRouter (stream: true)
```

1. 브라우저가 생성 요청을 보내면 서버는 `generation_requests`에 작업을 기록합니다.
2. worker가 작업을 가져가(claim) OpenRouter 스트림을 엽니다.
3. 받은 delta는 답변 본문과 `generation_events`에 한 transaction으로 저장합니다.
4. 브라우저에는 DB에 저장된 이벤트만 SSE로 보냅니다. 최종 저장이 끝나야 완료로 표시합니다.

생성은 명시적인 중단이나 채팅 삭제로만 취소됩니다. 탭을 닫는 건 취소가 아닙니다.

### Database

| 테이블 | 역할 |
| --- | --- |
| `chats` | 채팅 이름과 이름 생성 상태 |
| `messages` | user/assistant 메시지, 순서, 응답 상태 |
| `generation_requests` | 중복 요청 방지 키, worker claim, lease, 중단 상태 |
| `generation_events` | generation별로 순서가 매겨진 delta/종료 이벤트 |

`messages(chat_id, sequence_no)`와 `generation_events(generation_id, event_seq)`에 unique 제약을 걸어 순서가 꼬이지 않게 합니다. `client_request_id` unique로 같은 요청이 두 번 등록되는 것을 막습니다.

## Getting Started

필요한 것: Node.js 26 (`.nvmrc`), pnpm (corepack), Docker

```sh
nvm use
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env   # OPENROUTER_API_KEY 입력
pnpm db:up
pnpm db:generate
pnpm db:migrate
pnpm dev
```

[http://localhost:3000](http://localhost:3000)을 엽니다. `pnpm dev`는 웹 서버와 worker를 함께 띄웁니다. 화면과 DB 초기화만 확인할 때는 API Key가 없어도 됩니다.

DB 컨테이너는 `pnpm db:down`으로 멈춥니다. 데이터는 지워지지 않습니다.

## Scripts

| 명령 | 설명 |
| --- | --- |
| `pnpm dev` | 웹 서버 + worker 개발 모드 |
| `pnpm lint` | Biome 검사 |
| `pnpm typecheck` | 라우트 타입 생성 + `tsc --noEmit` |
| `pnpm test` | 단위 테스트 (DB 테스트는 `TEST_DATABASE_URL`이 있을 때만 실행) |
| `pnpm test:e2e` | Playwright 브라우저 테스트 |
| `pnpm build` | Prisma Client 생성 + 프로덕션 빌드 |
| `pnpm audit` | 의존성 취약점 검사 (CI에서 low 이상이면 실패) |

shadcn/ui 컴포넌트는 CLI를 프로젝트 의존성으로 두지 않고, 필요할 때만 실행합니다.

```sh
pnpm dlx shadcn@4.23.0 add <component>
```

통합 테스트는 개발 DB와 분리된 테스트 DB에서 돌립니다.

```sh
docker compose exec db createdb -U chatbot chatbot_test
DATABASE_URL=postgresql://chatbot:local_dev_password@localhost:55432/chatbot_test?schema=public pnpm db:migrate
TEST_DATABASE_URL=postgresql://chatbot:local_dev_password@localhost:55432/chatbot_test?schema=public pnpm test:db
```

테스트에는 실제 OpenRouter 대신 가짜 스트림을 씁니다. 분할 이벤트, 중간 오류, 갑작스러운 EOF 같은 경우도 이 스트림으로 확인합니다.

## Project Structure

```text
src/
├─ app/              # 페이지, Route Handler, 전역 스타일
├─ api/chat/         # 브라우저에서 쓰는 API 클라이언트
├─ components/       # 채팅 UI, 공통 UI
├─ hooks/            # 채팅 조회·라우팅·SSE 구독
├─ lib/server/       # DB·검증·OpenRouter 등 서버 전용 로직
├─ store/            # Zustand store
└─ worker/           # generation claim·stream·저장 worker
prisma/              # schema, migrations
tests/               # unit / integration / e2e
vendor/              # 보안 패치된 의존성 (vendor/README.md 참고)
```
