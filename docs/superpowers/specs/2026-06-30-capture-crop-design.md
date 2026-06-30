# 서브프로젝트 B — 캡처 중 크롭 설계 (spec, 개요)

날짜: 2026-06-30
선행: 서브프로젝트 A(`2026-06-30-image-zoom-crop-design.md`)의 `openImageViewer` 뷰어가 있어야 함.
관련: ADR-013(iOS WebKit), 캡처 루프(PRD §16, ADR-011)

## Context

사용자는 크롭을 **캡처 중에도** 하고 싶어 한다("둘 다"). 단 캡처 3초 루프는 신성하므로(PRD §16), 캡처-중-크롭은 **기본 건너뛰기(선택)** 여야 하고 빠른 경로를 느리게 하면 안 된다.

## 범위

포함: 캡처 흐름에서 동결 프레임을 **선택적으로** 크롭. SP-A의 `openImageViewer`를 재사용.
범위 밖: 새 뷰어 구현(SP-A에 있음), 자동 크롭.

## 설계 개요

- `screens/capture.ts`의 동결(프리즈) 상태(셔터 후 태그/왜 단계)에 작은 **`✂︎` 선택 버튼** 노출. 누르면 동결 프레임 Blob으로 `openImageViewer(frozenBlob, { onCrop })`.
- `onCrop(blob,w,h)` → 이번 캡처의 저장 이미지로 사용(기본 백그라운드 `resizeCompress` 대신 크롭 결과 사용). 안 누르면 현재 동작 그대로(전체 프레임 → 배경 압축).
- 버튼 미사용 시 루프 영향 0(자동 포커스/블로킹 없음).

## 검증

`npm run build` + `npm run preview` + **iPhone Safari 실기기**(핀치/크롭). 캡처 중 크롭한 이미지가 저장·상세·Export에 반영되는지. 크롭 안 한 캡처는 기존과 동일하게 빠른지(HUD appMs).

## 주의

- 동결 프레임의 원본 해상도 vs 크롭 후 재인코딩 경로 정리(SP-A 크롭은 ≤3200/0.8). 캡처 흐름의 기존 배경 압축과 중복되지 않게 분기.
- 상세 설계·plan은 SP-A의 `openImageViewer` 확정 후 작성.
