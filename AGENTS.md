# AGENTS.md

## Development Workflow / 개발 작업 흐름

* Keep changes focused on the requested task.
  변경 사항은 요청받은 작업 범위에 집중한다.

* Prefer minimal, targeted verification during development.
  개발 중에는 변경 범위에 집중된 최소한의 검증을 우선한다.

* By default, do not run repository-wide verification commands locally, including `npm run build`, full `npm test`, and `cargo check`.
  기본적으로 `npm run build`, 전체 `npm test`, `cargo check`를 포함한 저장소 전체 검증 명령은 로컬에서 실행하지 않는다.

* GitHub Actions CI is responsible for repository-wide verification after push.
  Push 이후 저장소 전체 검증은 GitHub Actions CI가 담당한다.

* During development, prefer narrow tests or checks that directly validate the changed behavior when available.
  개발 중에는 가능한 경우 변경된 동작을 직접 검증하는 좁은 범위의 테스트나 검사를 우선한다.

* Full local verification is allowed when the change is high-risk, affects build or shared infrastructure, changes database migrations/schema, or when CI cannot adequately verify it.
  변경 사항의 위험도가 높거나, build 또는 공통 기반 구조에 영향을 주거나, DB migration/schema를 변경하거나, CI만으로 충분히 검증할 수 없는 경우에는 전체 로컬 검증을 허용한다.

* If the user explicitly requests full local verification, perform it.
  사용자가 전체 로컬 검증을 명시적으로 요청한 경우에는 수행한다.

## CI Responsibility / CI의 역할

GitHub Actions currently performs repository-wide checks including:
현재 GitHub Actions는 다음을 포함한 저장소 전체 검사를 수행한다.

* Web application build / TypeScript validation through the existing build script.
  기존 빌드 스크립트를 통한 웹 애플리케이션 빌드 / TypeScript 검증

* Offline collector tests.
  오프라인 Collector 테스트

* Tauri/Rust backend `cargo check`.
  Tauri/Rust 백엔드 `cargo check`

Do not duplicate these repository-wide checks locally by default.
기본적으로 이러한 저장소 전체 검사를 로컬에서 중복 실행하지 않는다.

## External Services / 외부 서비스

* Do not use live KONEPS API calls as routine tests.
  일상적인 테스트에 실제 KONEPS API 호출을 사용하지 않는다.

* Do not expose or commit API keys or other secrets.
  API 키나 기타 비밀 정보를 노출하거나 커밋하지 않는다.

* Prefer offline tests, fixtures, and existing test infrastructure for verification.
  검증에는 오프라인 테스트, fixture 및 기존 테스트 인프라를 우선 사용한다.
