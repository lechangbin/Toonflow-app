# Agent Harness baseline freeze — Issue #57

## Outcome and responsibility boundary

This report freezes the merged, reproducible baseline for the Agent Harness. App issues #39, #44, and #43 are closed after remote integration. Web build-reproducibility fixes were merged through Toonflow-web PRs #2 and #3 before the final bundle was synchronized back to App.

No paid/real Vendor request, deployment, browser acceptance, database reset, or production-data mutation was performed. The gates use temporary databases and local fakes.

## Frozen source identities

| Repository | Role | Commit |
| --- | --- | --- |
| `lechangbin/Toonflow-app` | starting point containing accepted #41/#42 | `b385f74993f5855d6a79f0c4991d2465cbdf9e59` |
| `lechangbin/Toonflow-app` | #44 merge, PR #78 | `494cdd39f27c159302abeff6e277ce149dfa41d1` |
| `lechangbin/Toonflow-app` | #39 merge after #44, PR #79 | `db2442595cf219b6be8770b9661df4cf3f7f8c17` |
| `lechangbin/Toonflow-app` | final source/bundle baseline | `38c15c603c82a26a6048f91cf1bfecbab0a6d83a` |
| `lechangbin/Toonflow-web` | accepted starting point | `e8a9881aa0631cbaf1a3cf7b3978061a77f5da6b` |
| `lechangbin/Toonflow-web` | #39 → #44 integration, PR #1 | `9a0506e61fae189d0efa03453d6b80c0f2339e36` |
| `lechangbin/Toonflow-web` | clean-checkout type declarations, PR #2 | `56f337336fba8147e1d4cf502010d23ddda4d496` |
| `lechangbin/Toonflow-web` | final cross-platform reproducibility baseline, PR #3 | `c8c0bf48cde30b4634c05b652454b701f8980e04` |
| `lechangbin/Toonflow-app` | explicitly excluded #32 commit | `9300bc513fb995839b670ae27f1d967eff43618b` |

`git merge-base --is-ancestor 9300bc5 db24425` exits `1`, proving that rejected #32 work is not in the accepted App ancestry.

## Toolchain and dependency identity

Verification date: 2026-09-20, Asia/Shanghai.

| Item | Value |
| --- | --- |
| Node.js | `v24.14.0` |
| Yarn | `1.22.22` |
| App `packageManager` | `yarn@1.22.22` |
| Web `packageManager` | not declared; verification used Yarn `1.22.22` |
| App `package.json` canonical SHA-256 | `7DE9E5F5CB935565D34814DCC5ACC5B295095A3E663BFE02AF452E795BACA104` |
| App `yarn.lock` canonical SHA-256 | `8D72A0757D3151D6F2D59C646678351B643E800F895BFF4B35BB4A8E717581CE` |
| Web `package.json` canonical SHA-256 | `74C8ED73EABD7669F4F537464CC390BF046CBD0D7CDF4627A0604C1B19B56993` |
| Web `yarn.lock` canonical SHA-256 | `D25B0901962D8AEC1D570C9EA4CB96D88A45880D0031473ECDB9AEA8721C2564` |

“Canonical SHA-256” means SHA-256 over the exact Git blob bytes at the frozen commit. This avoids treating Windows checkout line-ending conversion as source drift.

## Database and generated-contract identity

ToonFlow uses code-owned initialization/repair instead of a numbered migration directory.

| Canonical App Git blob | SHA-256 |
| --- | --- |
| `src/lib/initDB.ts` | `EF66935AB762307A9BB797E444A85269999A7382C38654C4A77E7AACFB9E0829` |
| `src/lib/fixDB.ts` | `8EC078D7BC4666F5F4A4898B75B4F5892DDC774E7B342A392BE0C78248271B0E` |
| `src/database/readiness.ts` | `3F5F58983A7C87CA6C791059FE89987CB8870B9A895B707E25A5DAE2EDCD2FF7` |
| generated `src/lib/vendor.json` | `84DBDF5FF688002408A6C85864443D928882489EEC78121C98EBFACC22FC54A6` |
| generated `src/router.ts` | `7FC54FBBFD6D44AF93214DBF15C104C25AB61D8ECD1867274D023C47EFEC4822` |

The final Web baseline additionally versions and verifies its Vite-generated type declarations:

| Canonical Web Git blob | SHA-256 |
| --- | --- |
| `src/types/auto-imports.d.ts` | `CDF94882F4F9BE64F9053B809C7D524362366B93424A344B8768E453375C87C6` |
| `src/types/components.d.ts` | `C7D595D41C39C12588F54D3CF33A56B77388FD8515621C98AFB088C2891364EE` |

Web `yarn build` regenerates both declarations, asserts that they are Git-tracked, and fails if their canonical contents drift. `.gitattributes` pins their generator-owned LF representation across platforms.

## Generated bundle provenance

The App backend bundle was rebuilt from App source:

| Canonical App artifact | SHA-256 |
| --- | --- |
| `data/serve/app.js` | `1FF8DC3759D9D2B90E5DCAD9A95873E9DD755BDD0CDA98220C164D2EB6DAC31B` |

The frontend was rebuilt twice from Web commit `c8c0bf48cde30b4634c05b652454b701f8980e04`. Both builds produced the same `index.html` hash. The six Web `dist` files were then copied byte-for-byte into App commit `38c15c603c82a26a6048f91cf1bfecbab0a6d83a`:

| Relative artifact | Web `dist` and App `data/web` SHA-256 |
| --- | --- |
| `css.worker-BvV5MPou.js` | `987EAD025460E67B0B75E64F8911D7827F678EEF74EB486E2F7F2FCDD14A863E` |
| `favicon.ico` | `6599F29B3378F5C81563D39482905090D3584FA83C26FF9660D5898410F19570` |
| `html.worker-BLJhxQJQ.js` | `7A374FB540AB509490411D6251D48649743AEE9BD7E9102AA04C69F987DDCD08` |
| `index.html` | `592CFF1F53D3FCA90B0D4CDB25BAB9382FEAF7E818BD961A53AD4A11C20DD492` |
| `json.worker-usMZ-FED.js` | `CE8C37E60F789FE213BF461BF15E66FA5425D9F82E74DD3D92A576D0C29ACF59` |
| `ts.worker-DGHjMaqB.js` | `9752302F8E0A7627A90E0C16D5AF46AE223A3593DF7F3BBBAF162DBD3AD80C06` |

Authoritative inputs are App/Web source and Vendor adapter source. Generated bundles and declarations are verification outputs, never implementation sources.

## Gate results

### App merged baseline

Run from a fresh worktree at `db2442595cf219b6be8770b9661df4cf3f7f8c17`:

| Command | Result |
| --- | --- |
| `yarn test` | 406/406 passed |
| `yarn lint` | passed (`tsc --noEmit`) |
| `yarn build` | passed |
| `git diff --check b385f74..HEAD` | passed |

### Web final baseline

Run from a fresh worktree with a physical `yarn install --frozen-lockfile`, not a cross-worktree dependency link:

| Command | Result |
| --- | --- |
| `yarn type-check` before any Vite invocation | passed |
| `yarn test:contract` | 89/89 passed |
| `yarn build` | passed; Vite transformed 11,101 modules and the declaration drift guard passed |
| `yarn i18n:check` | exited 0; existing unused/hard-coded inventory and two missing keys remain explicitly unresolved |
| `git diff --check e8a9881..HEAD` | passed |
| repeated `yarn build` | stable `index.html` SHA-256 and no generated declaration diff |

The fresh-worktree exercise exposed and fixed two hidden environmental assumptions: ignored type declarations that required a prior Vite run, and Windows line-ending stat noise after deterministic regeneration. Standards and Spec re-review found no remaining actionable issue.

## Reproduction procedure

1. Fetch both repositories and create clean worktrees at App `38c15c603c82a26a6048f91cf1bfecbab0a6d83a` and Web `c8c0bf48cde30b4634c05b652454b701f8980e04`.
2. Install dependencies with `yarn install --frozen-lockfile` using Yarn `1.22.22` and Node.js `v24.14.0`.
3. In Web, run `yarn type-check` before any Vite command, followed by `yarn test:contract`, `yarn build`, `yarn i18n:check`, and `git diff --check e8a9881..HEAD`.
4. In App, run `yarn test`, `yarn lint`, `yarn build`, and `git diff --check b385f74..HEAD`.
5. Compare relative filenames and SHA-256 hashes under Web `dist` and App `data/web` against the table above.
6. Hash canonical Git blob bytes for source/schema files rather than platform-converted checkout bytes.
7. Require no semantic diff after generated-output checks; line-ending behavior is fixed by the committed attributes.

## Completion

The functional blockers are merged and closed, exact merged identities are frozen, clean-checkout gates pass, generated-output provenance is enforced, and this versioned report is reproducible without relying on the planning conversation. The commit containing this report is evidence-only and follows the exact App source/bundle baseline `38c15c603c82a26a6048f91cf1bfecbab0a6d83a`.
