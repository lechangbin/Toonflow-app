# Issue tracker: GitHub

Issues and specs live in the official `HBAI-Ltd/Toonflow-app` GitHub Issues tracker. Use the `gh` CLI and pass `--repo HBAI-Ltd/Toonflow-app` explicitly because this clone also has a personal fork remote.

## Conventions

- Create: `gh issue create --repo HBAI-Ltd/Toonflow-app --title "..." --body "..."`
- Read: `gh issue view <number> --repo HBAI-Ltd/Toonflow-app --comments`
- List: `gh issue list --repo HBAI-Ltd/Toonflow-app --state open --json number,title,body,labels,comments`
- Comment: `gh issue comment <number> --repo HBAI-Ltd/Toonflow-app --body "..."`
- Label: `gh issue edit <number> --repo HBAI-Ltd/Toonflow-app --add-label "..."`
- Close: `gh issue close <number> --repo HBAI-Ltd/Toonflow-app --comment "..."`

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub shares one number space across issues and PRs. Resolve an ambiguous `#<number>` with `gh pr view` first, then fall back to `gh issue view`.

## Skill operations

- “Publish to the issue tracker” means create an issue in `HBAI-Ltd/Toonflow-app`.
- “Fetch the relevant ticket” means read the issue and its comments from that repository.
- Pull requests target `develop`; the upstream `master` branch does not accept PRs.

## Wayfinding

Use one issue labelled `wayfinder:map` as the map and GitHub sub-issues as child tickets. Represent blockers with native issue dependencies when available; otherwise use a `Blocked by: #<number>` line. Claim work by assigning the issue before the first write.
