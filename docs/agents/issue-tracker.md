# Issue tracker: GitHub

Issues and specs live in the personal development repository, `lechangbin/Toonflow-app`. Use the `gh` CLI and pass `--repo lechangbin/Toonflow-app` explicitly so work never lands in the read-only upstream tracker by accident.

## Conventions

- Create: `gh issue create --repo lechangbin/Toonflow-app --title "..." --body "..."`
- Read: `gh issue view <number> --repo lechangbin/Toonflow-app --comments`
- List: `gh issue list --repo lechangbin/Toonflow-app --state open --json number,title,body,labels,comments`
- Comment: `gh issue comment <number> --repo lechangbin/Toonflow-app --body "..."`
- Label: `gh issue edit <number> --repo lechangbin/Toonflow-app --add-label "..."`
- Close: `gh issue close <number> --repo lechangbin/Toonflow-app --comment "..."`

## Repository workflow

`lechangbin/Toonflow-app` is the final public repository for personal secondary development. Use GitHub Issues for scope and decisions, development branches for isolation, and commits for completed work. Keep `HBAI-Ltd/Toonflow-app` as a read-only synchronization source.

## Skill operations

- “Publish to the issue tracker” means create an issue in `lechangbin/Toonflow-app`.
- “Fetch the relevant ticket” means read the issue and its comments from that repository.

## Wayfinding

Use one issue labelled `wayfinder:map` as the map and GitHub sub-issues as child tickets. Represent blockers with native issue dependencies when available; otherwise use a `Blocked by: #<number>` line. Claim work by assigning the issue before the first write.
