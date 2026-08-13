# MONA RADAR / Market

## Project purpose

MonaRadar Market은 나라장터(KONEPS) 기반 공공조달 시장 데이터를 수집·검색·분석하기 위한 독립 데스크톱 프로젝트입니다.

## Architecture

MonaRadar Company의 검증된 Tauri 2, Vite, TypeScript UI/Application shell을 기반으로 시작했습니다. Collector와 데이터 모델은 Company와 공유하지 않고 Market 요구사항에 맞춰 독립적으로 개발합니다.

## Data source

나라장터 OpenAPI를 사용할 예정입니다.

## Collector

향후 HTTP REST API 기반 Collector를 구현합니다. Playwright, SMINFO 로그인·세션, Windows Credential Manager 기반 Company Collector는 사용하지 않습니다.

## Current status

Market project shell 생성 단계입니다. Collector, 실제 KONEPS API 연결, API 키 설정, Market SQLite 파일 및 DB schema는 아직 구현하지 않았습니다. Search, Dash, Analysis, Collector 화면은 향후 기능을 연결할 수 있는 placeholder 상태입니다.

## Next step

`나라장터 OpenAPI 분석 → Market 데이터 모델 설계 → Collector architecture 설계 → 첫 API 연결` 순서로 진행합니다.

## Development

```powershell
npm install
npm run typecheck
npm run build
npm run tauri dev
```

Windows NSIS 설치 파일은 `npm run tauri build -- --bundles nsis`로 생성합니다.
