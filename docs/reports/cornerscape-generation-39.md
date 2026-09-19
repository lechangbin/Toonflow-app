# CornerScape generation recovery — Issue #39

## Implemented scope

- Generation errors retain the existing `{code, data: null, message, error}` envelope and optionally add `affectedAssets: [{id, name}]`. Stale prompt detection collects every stale base Asset in the selected batch instead of stopping at the first one. No image placeholders or Vendor image requests are created for a rejected batch.
- CornerScape lists the affected Asset names/IDs in a Yes/Cancel dialog. Yes submits only their prompt regeneration through the existing batch orchestration; Cancel submits nothing. Prompt completion does not silently bill another image request: the user clicks image generation again.
- Single, batch, CornerScape, and Production Agent image generation share the persisted `等待中 → 生成中 → 下载中 → terminal` lifecycle. `生成中` is emitted only after a Vendor adapter obtains its real invocation slot; Agnes requests still waiting in its local serial queue remain `等待中`. Base64 results skip `下载中`.
- Cancellation is terminal, restart recovery fails interrupted active rows, ambiguous timeout outcomes are not automatically replayed, and late Vendor results cannot overwrite a cancelled record. Stable `kind:hash` failure fingerprints survive parent-Asset refresh without exposing raw provider text.
- A batch displays its started notification only after HTTP acceptance. Repeated pending submissions are blocked. Single-image and CornerScape flows poll authoritative backend state while their blocking POST remains in flight; transient missing rows receive a bounded three-poll grace period.
- Production Agent socket acknowledgement reports success only when the backend accepted generation; rejection never leaves a fake active state.
- `POST /api/project/setImageModel` validates an Image Model and updates only `o_project.imageModel`. Both model selectors use this route; writes are serialized, failures restore the last saved choice, and generation is blocked while the preference is saving.
- Integration obeys decision #46. App starts from accepted #44 head `d0351cf` and semantically ports #39 without inheriting #32. Web starts from `e8a9881` and applies #39 (`af149a5`), then #44 (`ae10b8a`), then review fixes (`1647364`). App `data/web` is rebuilt from that Web source and its six artifact hashes match the Web `dist` output byte for byte.

## Generation phase contract

This is a cross-boundary contract, not a set of frontend labels. `o_image.state` is authoritative; frontends only project polling results. The configured Image Vendor boundary carries factual stage callbacks while retaining provider-independent input/output contracts.

| Phase | Truthful entry event | Required change |
| --- | --- | --- |
| Waiting | Backend accepted the operation, but the request has not obtained the Vendor invocation slot | Persisted before dispatch and visible through polling/reload |
| Generating | The adapter obtained its local execution slot and is about to issue the Vendor HTTP request | Adapter emits `generating`; this does not claim cloud acceptance |
| Downloading | Provider returned an image URL and ToonFlow began the media network request | Adapter emits `downloading`, then `downloaded`; Base64 skips this phase |
| Completed / Failed / Cancelled | Durable terminal outcome | Conditional writes preserve cancellation and prevent late success from overwriting it |

Base64-in-response results do not have a separate image download request and should skip Downloading. Disk writes must not be mislabeled as a network download. No simulated timing or progress percentage should be used.

Coverage includes single/batch/Production Agent entry points, queue-slot truth, queued cancellation, reload, restart recovery, timeout, URL download failure, Base64 results, redaction, and terminal-write races. Task phase remains independent from selected Asset image history.

## Zero-reference generation diagnosis, 2026-09-03

Read-only production evidence from Debian-13, container `toonflow-0719fef-6d124f5-local`:

- Assets 5, 6, 7 entered image generation with `agnes-image-2.5-flash`, zero references, 1K and 16:9. The batch endpoint returned HTTP 200.
- HTTP attempts began at approximately 06:13:34 UTC. Retry logs appeared at 06:19:34 UTC and 06:25:37 UTC: 360-second timeouts plus the adapter's 3-second first backoff.
- All three eventually persisted `生成失败`. Their reason hash exactly matches SHA-256 of `Agnes 图片生成失败：timeout of 360000ms exceeded` (`d42ee89831db3dff9e435f26e72eb750e4b4ab3f1649150f0d7eaf7aa574f99a`). This confirms request timeout rather than stale prompts or image-download failure.
- An offline replay of the actual adapter with timeout transport errors makes three attempts, zero downloads, and returns the same message/hash. No paid request was sent by this investigation.
- A credential-free connectivity probe to the configured service origin returned HTTP 200 in about 2.2 seconds. This establishes origin reachability only, not generation endpoint health or authorization.

The underlying cause of the provider request not returning within 360 seconds is not established: provider processing delay, endpoint/gateway behavior, and connection problems during the request remain possible. The log saying a request entered the image queue is local, not a provider task acknowledgement. This synchronous API path records no provider task ID. Do not change the request format, increase timeouts, or resubmit potentially billable requests without further evidence.

Next diagnostic improvement: retain safe HTTP status, transport code, attempt number, elapsed time and provider request ID (when available), while excluding credentials, prompt bodies and raw Base64. A controlled real-provider reproduction would require separate authorization and correlation with provider-side logs.

## Verification

App: 406 tests passed, focused #39 tests passed 74/74, `yarn lint` passed, and `yarn build` passed. Web: 88 contract tests passed, `yarn type-check` passed, and `yarn build` passed. The contract tests execute the relevant Vue handlers for rejected submission, cancellation, selective prompt recovery, accepted submission, bounded missing-record handling, and serialized model saving. The two previously known i18n gaps remain outside this issue.

No runtime deployment, browser viewing, data reset, or real Model call is part of this patch.
