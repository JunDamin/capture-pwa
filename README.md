# Capture

> 생각은 지금 붙잡고, 지식은 나중에 만든다.

독서 노트 앱이 아니라, **사람의 경험을 AI가 이해할 수 있는 형태로 구조화하는 입력 인터페이스**.
독서 중 떠오른 생각을 3초 안에 붙잡고(태그 + 담은 글/생각/사진), 나중에 외부 AI(ChatGPT/Claude)에게 넘겨 지식으로 키운다.

설치형 PWA · 서버/로그인 없음 · 데이터는 IndexedDB에 로컬 저장.

## 문서

- [PRD.md](PRD.md) — 제품 요구사항 (v1.2)
- [docs/decisions.md](docs/decisions.md) — 설계 결정 기록 (ADR-001~019)
- [docs/glossary.md](docs/glossary.md) — 용어집
- [docs/design-language.md](docs/design-language.md) — 디자인 언어 (토스 derived)

## 개발

```bash
npm install
npm run dev      # http://localhost:5173 (카메라는 localhost/https 필요)
npm run build    # 타입체크 + 프로덕션 빌드
npm run test:pdf # PDF 생성 스모크(chromium) — iOS Safari는 실기기로 확인
```

캡처 화면 좌상단의 **예산 HUD**가 카메라 웜업·앱 개입 시간(appMs)·사람 판단 시간·압축·용량을 실측한다 (목표: 웜업 ≤1s, appMs ≤300ms — PRD §16, ADR-011).

## 배포

`main`에 push하면 GitHub Actions가 빌드해 GitHub Pages로 배포한다.
(Pages 하위 경로는 워크플로가 저장소 이름으로 `base`를 자동 주입)

## 상태

MVP 전체 흐름 완료 — Home · 세션 관리 · 캡처 루프 · Review · Export 구현·배포됨.
라이브: https://jundamin.github.io/capture-pwa/ (설치형 PWA, 오프라인 동작)

다음 마일스톤은 [PRD §18 로드맵](PRD.md) 참고.
