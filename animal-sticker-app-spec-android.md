# 동물 인식 스티커 앱 구현 스펙 — Android(갤럭시 S25) 버전 (토큰/비용 최소화 우선)

> 이 문서는 Claude Code에게 그대로 전달해서 구현을 시작할 수 있도록 작성한 기술 스펙입니다.
> 참고 앱: "Gotcha: Animal Identifier" — 동물/곤충 사진을 찍으면 배경에서 오려내 스티커로 만들고, 종 이름을 인식해 도감처럼 수집하는 앱.
> 타깃 플랫폼: **Android (갤럭시 S25 기준)**. iOS 전용 API는 전부 Android/ML Kit 대응 기능으로 교체했습니다.

## 0. 핵심 설계 원칙

**LLM(Claude/GPT 등 비전 API)은 최후의 수단으로만 쓴다.** 파이프라인의 기본 경로는 100% 온디바이스 또는 자체 호스팅 경량 모델로 처리하고, 자신 없는 케이스에서만 저렴한 비전 모델을 호출한다. 이렇게 하면:

- 대부분의 요청은 API 호출 자체가 없어 토큰 비용이 0
- LLM 호출이 필요한 경우에도 이미지를 최대한 작게(피사체만 크롭 + 다운스케일) 만들어서 토큰을 최소화
- 트래픽이 바이럴로 튀어도 비용이 사용자 수에 비례해 폭증하지 않음

두 가지 서로 다른 문제를 반드시 분리해서 생각할 것:

1. **컷아웃(세그멘테이션)** — "사진에서 피사체만 깔끔하게 오려내기". LLM이 할 일이 아니다.
2. **종 인식(분류)** — "이게 무슨 생물인지 맞추기". 전용 분류 모델이 LLM보다 정확하고 저렴하다.

갤럭시 S25는 Snapdragon 8 Elite 계열 AP에 자체 NPU를 탑재하고 있어서, 온디바이스 세그멘테이션·분류 모델을 돌리기에 성능은 충분하다. 오히려 병목은 모델이 아니라 "언제 LLM을 호출하느냐"는 설계 쪽이다.

---

## 1. 전체 파이프라인

```
[카메라 촬영]
      │
      ▼
[1단계: 온디바이스 컷아웃 — ML Kit Subject Segmentation] ── 비용 0, 네트워크 호출 없음
      │  (피사체 전경 마스크/비트맵 획득)
      ▼
[2단계: 온디바이스/자체서버 종 분류 모델] ── 비용 0에 가까움 (자체 인프라 비용만)
      │
      ├─ confidence ≥ threshold(예: 0.75) → 바로 결과 사용, 종료
      │
      └─ confidence < threshold
             │
             ▼
      [3단계: 저가 비전 LLM 폴백] ── 여기서만 토큰 소모
             │  (크롭 + 다운스케일된 이미지만 전송, 구조화된 JSON 응답 요청)
             ▼
      [결과 확정 → 로컬 DB 저장 → 스티커/도감에 반영]
```

---

## 2. 1단계: 컷아웃 (배경 제거) — ML Kit Subject Segmentation

Google이 Android용으로 공식 제공하는 **ML Kit Subject Segmentation API**를 사용한다.

- 완전히 온디바이스에서 실행된다. 모델은 Google Play 서비스를 통해 동적으로 내려받는 "언번들형"이 기본이며(앱 용량 증가 약 200KB), 런타임에 네트워크 호출이나 과금이 전혀 없다.
- 최소 API 레벨 24부터 지원하므로 갤럭시 S25(최신 One UI/Android)에서는 당연히 호환된다.
- 동작 방식: 픽셀 단위로 0~1 사이 "전경 확신도(confidence)"를 담은 마스크를 반환한다. 이 마스크를 임계값(보통 0.5)으로 이진화해서 배경을 투명 처리한 스티커용 비트맵(`getForegroundBitmap()`)을 바로 얻을 수 있다.
- 입력 이미지는 최소 512x512px 이상을 권장 — 카메라로 찍은 원본 그대로 넣으면 되고, 별도 전처리 없이도 잘 동작한다.

### 사용 흐름 (Claude Code에게 요청할 작업 예)

> "com.google.mlkit:segmentation-subject 의존성을 추가하고, 카메라로 찍은 Bitmap을 입력받아 SubjectSegmenter로 전경 마스크를 추출한 뒤, 배경을 투명 처리한 PNG(스티커용 Bitmap)와 피사체 바운딩박스를 함께 반환하는 Kotlin 클래스를 작성해줘. 신뢰도 마스크에서 바운딩박스를 계산하는 로직도 포함해줘 (다음 단계에서 크롭에 쓸 거야)."

```kotlin
// 예시 스켈레톤 (Claude Code가 채워야 할 부분)
val options = SubjectSegmenterOptions.Builder()
    .enableForegroundBitmap()
    .build()
val segmenter = SubjectSegmentation.getClient(options)

segmenter.process(inputImage)
    .addOnSuccessListener { result ->
        val stickerBitmap = result.foregroundBitmap // 배경 투명 처리된 비트맵
        // 이 bitmap의 non-transparent 영역으로 바운딩박스를 구해
        // 2단계 분류 모델과 3단계 LLM 폴백에 "크롭된 이미지"로 재사용한다
    }
```

### 참고 — 왜 iOS의 Vision 프레임워크 대신 이걸 쓰는가

원래 참고 앱은 iOS 기반이라 Apple의 `VNGenerateForegroundInstanceMaskRequest`를 썼을 가능성이 높지만, 갤럭시 S25는 Android이므로 대응되는 Google 공식 API인 ML Kit Subject Segmentation을 쓰면 된다. 개념과 파이프라인 상 역할은 완전히 동일하다(온디바이스 전경/배경 분리, 비용 0).

---

## 3. 2단계: 종 분류 (species classification)

### 왜 범용 LLM 대신 전용 분류 모델을 써야 하는가

- 범용 비전 LLM(Claude, GPT-4V, Gemini)은 "이 사진 속 생물이 뭐야?"에 어느 정도 답할 수 있지만, 세밀한 종(species) 단위 구분에서는 전문 분류 모델보다 정확도가 떨어지고, 드물게 그럴듯한 오답(할루시네이션)을 낸다.
- 반면 iNaturalist 데이터셋으로 학습된 분류 모델은 수천~수만 종을 대상으로 특화 학습되어 있어 정확도가 더 높고, 자체 인프라에서 돌리면 호출당 비용이 사실상 없다(추론 컴퓨팅 비용만 존재, 토큰 단가 없음).

### 구현 방법

1. **데이터**: iNaturalist 공개 데이터셋(iNat2021 등) — 오픈 라이선스 기반. 타깃 지역/분류군(한국에서 흔한 곤충·조류·포유류·파충류 등)으로 서브셋을 추리는 걸 권장.
2. **모델**: MobileNetV3-Small 또는 EfficientNet-Lite0 같은 경량 CNN을 백본으로 전이학습(transfer learning). Hugging Face나 GitHub에 iNaturalist로 사전학습된 체크포인트가 이미 존재하므로 처음부터 학습할 필요 없음.
3. **배포 — ML Kit Custom Model(번들형)**:
   - 학습된 모델을 `.tflite`로 변환해 앱 `assets/` 폴더에 포함시키고, `com.google.mlkit:image-labeling-custom` 라이브러리로 로드한다.
   - 번들형은 앱 용량이 (모델 크기만큼, 경량 모델 기준 수 MB) 늘지만 완전 오프라인·완전 온디바이스로 동작해 네트워크/비용이 전혀 안 든다. 갤럭시 S25 정도 사양이면 추론 속도도 실시간에 가깝다.
   - 종 커버리지를 계속 늘리거나 모델을 자주 업데이트해야 한다면, 언번들형(Play 서비스 동적 다운로드) 또는 자체 서버(FastAPI 등) 추론 엔드포인트로 전환하는 것도 고려할 수 있다. 이 경우도 LLM 토큰 과금과는 무관한 "요청당 고정 컴퓨팅 비용" 구조라 훨씬 예측 가능하다.
4. **신뢰도 임계값**: top-1 확률이 일정 기준(예: 0.75) 이상이면 그대로 확정. 미만이면 3단계 LLM 폴백으로 넘긴다. 이 임계값을 튜닝하는 게 곧 "LLM 호출 빈도 = 비용"을 조절하는 다이얼이 된다.

### 사용 흐름 (Claude Code에게 요청할 작업 예)

> "iNaturalist 사전학습 MobileNetV3 체크포인트를 TFLite로 변환하는 Python 스크립트를 작성해줘. 그리고 ML Kit의 LocalModel + 커스텀 ImageLabeler를 사용해서, 1단계에서 나온 크롭된 Bitmap을 입력받아 (species_id, confidence) 목록(top-5)을 반환하는 Kotlin 클래스를 작성해줘."

```kotlin
// 예시 스켈레톤
val localModel = LocalModel.Builder()
    .setAssetFilePath("species_classifier.tflite")
    .build()
val options = CustomImageLabelerOptions.Builder(localModel)
    .setConfidenceThreshold(0.5f)
    .setMaxResultCount(5)
    .build()
val labeler = ImageLabeling.getClient(options)

labeler.process(croppedInputImage)
    .addOnSuccessListener { labels ->
        val top = labels.maxByOrNull { it.confidence }
        if (top != null && top.confidence >= 0.75f) {
            // 바로 확정, 3단계로 안 감 → 토큰 비용 0
        } else {
            // 3단계 LLM 폴백으로 후보 목록(labels)과 함께 전달
        }
    }
```

---

## 4. 3단계: LLM 폴백 (신뢰도 낮을 때만)

전용 모델이 확신하지 못하는 소수 케이스에서만 호출한다. 이 단계에서도 토큰을 최대한 아끼는 게 목표다. (이 부분은 플랫폼과 무관하게 서버 로직이라 iOS/Android 동일)

### 토큰을 줄이는 구체적 방법

- **크롭 후 전송**: 1단계에서 이미 피사체 바운딩박스를 알고 있으므로, 원본 전체가 아니라 피사체 영역만 크롭해서 보낸다. 배경까지 포함한 4000x3000 사진을 그대로 보내면 낭비.
- **다운스케일**: Claude는 이미지를 28x28px 타일 단위로 토큰화한다(가로 타일 수 × 세로 타일 수 = 비주얼 토큰 수). 예를 들어 1000x1000 이미지는 약 1,296 토큰인데, 이를 500x500으로만 줄여도 토큰이 대략 1/4로 줄어든다. 종 인식에는 그렇게 높은 해상도가 필요 없으므로, 장축 400~600px 정도로 리사이즈해서 전송하는 걸 권장.
- **저가 모델 사용**: Opus/Sonnet이 아니라 Haiku급(가장 저렴한 비전 지원 모델)을 쓴다. 정확도가 크게 필요한 작업이 아니라 "1차 모델이 놓친 후보 몇 개 중 골라주는" 보조 역할이기 때문.
- **구조화된 출력 강제**: 프롬프트에서 자유 텍스트 대신 JSON 스키마를 강제해서 (예: `{"species": "...", "confidence": 0.0-1.0}`) 출력 토큰도 최소화한다. 설명이나 사족을 요구하지 않는다.
- **후보 좁혀서 질문**: 2단계 모델이 이미 top-5 후보까지는 뽑아놨다면, LLM에게 "이 사진이 A, B, C, D, E 중 무엇에 가장 가까운가"처럼 객관식으로 물어보는 게 완전 자유 응답보다 훨씬 짧고 정확하다.
- **캐싱/중복 제거**: 이미지 해시(perceptual hash) 기반으로 이미 처리한 적 있는 사진(같은 사진 재전송, 스크린샷 재업로드 등)은 LLM 호출 없이 캐시된 결과를 재사용.
- **폴백 비율 모니터링**: "전체 요청 중 몇 %가 3단계까지 갔는지"를 로깅해서, 이 비율이 예산을 넘으면 2단계 임계값을 낮추거나 모델을 재학습하는 식으로 관리.

### 사용 흐름 (Claude Code에게 요청할 작업 예)

> "다음 조건을 만족하는 백엔드 엔드포인트(FastAPI)를 작성해줘: 크롭된 이미지를 받아 장축 512px로 리사이즈 후 JPEG 압축, Claude Haiku vision API에 '다음 후보 중 하나를 골라 JSON으로만 답하라'는 구조화 프롬프트와 함께 전송, 응답을 파싱해서 species_id와 confidence를 반환. 실패 시 재시도 로직 포함. 안드로이드 앱에서는 Retrofit/OkHttp로 이 엔드포인트를 호출하는 클라이언트 코드도 함께 작성해줘."

---

## 5. 데이터 저장 & 도감/수집 기능

- 로컬: **Room(SQLite 래퍼)** 을 사용해 사용자가 수집한 종, 스티커 이미지(또는 이미지 파일 경로), 희귀도 등급, 발견 날짜를 저장한다.
- 희귀도 등급: iNaturalist의 관찰 빈도 데이터나 IUCN 등급을 참고해 미리 로컬 분류 테이블(species_id → rarity_tier)을 만들어둔다. 이것도 런타임 API 호출이 아니라 정적 데이터(JSON/DB 프리로드)라 비용 없음.
- 멀티 디바이스/친구 비교 기능이 필요하면 이때부터 백엔드(사용자 계정, 컬렉션 동기화)가 필요해지지만, 이 부분은 순수 CRUD라 LLM/토큰과 무관.

---

## 6. 단계별 구현 로드맵 (Claude Code에게 순서대로 시킬 작업)

1. **Phase 1 — 컷아웃 프로토타입**: `ML Kit Subject Segmentation`으로 카메라 사진을 알파(투명 배경) 비트맵 스티커로 만드는 Android 데모 화면(Jetpack Compose 권장).
2. **Phase 2 — 온디바이스 분류기 통합**: iNaturalist 사전학습 모델을 TFLite로 변환, ML Kit Custom Model로 로드해 위 1의 크롭 이미지를 입력해 (species, confidence) 출력.
3. **Phase 3 — 로컬 도감 UI**: 인식 결과를 Room DB에 저장하고, 수집 카드/실루엣 그리드 UI(Jetpack Compose LazyGrid) 구현.
4. **Phase 4 — LLM 폴백 연동**: confidence 낮은 케이스에서만 백엔드 경유 Haiku 호출, 토큰 최소화 로직(크롭+리사이즈+JSON 강제) 포함.
5. **Phase 5 — 비용 모니터링**: 폴백 호출 비율, 일일 토큰 사용량을 로깅/대시보드화해서 임계값을 데이터 기반으로 튜닝.

---

## 7. 요약 체크리스트

- [ ] 컷아웃은 무조건 온디바이스(ML Kit Subject Segmentation)로, LLM에 맡기지 않는다
- [ ] 종 인식은 1차로 전용 경량 분류 모델(온디바이스 ML Kit Custom Model 또는 자체 서버)을 쓴다
- [ ] LLM은 confidence가 낮은 소수 케이스에만, 그것도 크롭+다운스케일된 작은 이미지로만 호출한다
- [ ] LLM 호출 시 저가 모델(Haiku급) + JSON 강제 출력으로 토큰을 최소화한다
- [ ] 동일 이미지 재요청은 해시 캐싱으로 걸러낸다
- [ ] 폴백 호출 비율을 지표로 추적해 비용을 예측 가능하게 관리한다
- [ ] 개발/테스트는 갤럭시 S25 실기기 기준으로 진행 (에뮬레이터는 카메라·NPU 성능 검증에 한계가 있음)
