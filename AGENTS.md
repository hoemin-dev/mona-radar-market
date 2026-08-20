# AGENTS.md

## Development Workflow / 개발 작업 흐름

* Keep changes focused on the requested task.
  변경 사항은 요청받은 작업 범위에 집중한다.

* Prefer minimal, targeted verification during development.
  개발 중에는 변경 범위에 집중된 최소한의 검증을 우선한다.

* Do not routinely repeat the full CI verification locally.
  전체 CI 검증을 로컬에서 습관적으로 반복하지 않는다.

* GitHub Actions CI is responsible for repository-wide verification after push.
  Push 이후 저장소 전체 검증은 GitHub Actions CI가 담당한다.

* Run only tests directly relevant to the changed code when practical.
  가능한 경우 변경된 코드와 직접 관련된 테스트만 실행한다.

* If a change is high-risk or affects shared infrastructure, run additional local verification as needed.
  변경 사항의 위험도가 높거나 공통 기반 구조에 영향을 주는 경우에는 필요에 따라 추가적인 로컬 검증을 수행한다.

## CI Responsibility / CI의 역할

GitHub Actions currently performs repository-wide checks including:
현재 GitHub Actions는 다음을 포함한 저장소 전체 검사를 수행한다.

* Web application build / TypeScript validation through the existing build script.
  기존 빌드 스크립트를 통한 웹 애플리케이션 빌드 / TypeScript 검증

* Offline collector tests.
  오프라인 Collector 테스트

* Tauri/Rust backend `cargo check`.
  Tauri/Rust 백엔드 `cargo check`

Do not duplicate all of these checks locally by default.
기본적으로 이 모든 검사를 로컬에서 중복 실행하지 않는다.

## External Services / 외부 서비스

* Do not use live KONEPS API calls as routine tests.
  일상적인 테스트에 실제 KONEPS API 호출을 사용하지 않는다.

* Do not expose or commit API keys or other secrets.
  API 키나 기타 비밀 정보를 노출하거나 커밋하지 않는다.

* Prefer offline tests, fixtures, and existing test infrastructure for verification.
  검증에는 오프라인 테스트, fixture 및 기존 테스트 인프라를 우선 사용한다.
