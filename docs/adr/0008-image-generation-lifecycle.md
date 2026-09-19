# Persist a real image generation lifecycle in `o_image.state`

Date: 2026-09-03

## Status

Accepted

## Context

Issue #39. Image generation previously exposed only a binary "生成中/已完成" impression driven by frontend timers and optimistic local state. A production incident showed three tasks stuck for ~18 minutes in blind triple-retry of ambiguous Agnes timeouts (`timeout of 360000ms exceeded`), with no distinction between queued, vendor-called, downloading, or failed phases, and no durable state across refresh or restart.

## Decision

`o_image.state` becomes the single authoritative image generation state machine, shared by the single-asset, batch, and Production Agent entries (contract in `src/assets/imageGenerationLifecycle.ts`, mirrored in the web app):

- 等待中 — batch request accepted by the backend, no local concurrency slot yet (persisted before entering the `p-limit` queue).
- 生成中 — an Image Vendor request has actually started.
- 下载中 — the vendor returned a URL and Toonflow is downloading the media (Base64 responses skip this state; local file or OSS writes never enter it).
- 已完成 / 生成失败 / 已取消 — terminal states; late vendor results cannot overwrite 已取消, and terminal writes are guarded by conditional SQL updates.

Vendor failures are classified into stable kinds (`imageGenerationTimeout` / `imageDownloadFailed` / `imageGenerationFailed` / `imagePersistenceFailed`) and persisted as `kind:sha256` fingerprints. Polling endpoints return one authoritative record per requested asset id, including `state: null` for missing rows so the frontend can never wait forever.

The vendor boundary emits both `downloading` and `downloaded`. A URL result enters 下载中 immediately before the network fetch and returns to the generic active 生成中 state immediately after the bytes arrive; subsequent local disk/OSS persistence is therefore never presented as an ongoing network download. This transition may look non-monotonic in labels, but it preserves the six-state public contract without inventing a misleading persistence phase.

Ambiguous transport outcomes (network timeout, connection reset) are never auto-replayed: the vendor may already have received the request and Agnes Image has no verified idempotency key or recoverable task id. Only explicit, safe, documented temporary rejections (HTTP 429 / documented busy 400) get a bounded retry. The pre-existing 360 s timeout is not extended as a "fix".

On process restart, `failInterruptedImageGenerations` (wired in `fixDB`) moves all non-terminal rows to 生成失败 with the local reason 软件退出导致失败 — there is no recoverable vendor task to resume; users retry through existing entry points.

## Consequences

- The frontend renders progress only from backend-polled state; no timers, delays, or percentage simulation may drive lifecycle display.
- Raw vendor exceptions, prompts, Base64 payloads, signed URLs, and API keys never reach persistence or the UI; only whitelisted sanitized diagnostics (stage, attempt, elapsedMs, transport code, HTTP status, cleaned provider request id, stable kind) are stored.
- Legacy `errorReason` rows may contain raw vendor text; the frontend only displays an allowlist of known-safe local reasons and otherwise falls back to localized stable-kind messages.
- Cancelling is honoured in all three active states; a late successful vendor response must not resurrect a cancelled task.
- Real Agnes contract verification remains owned by Issue #32; this ADR's retry policy must be revisited if Agnes ships verified idempotency keys.
