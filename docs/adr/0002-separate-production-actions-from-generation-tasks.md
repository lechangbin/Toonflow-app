# Separate Production Actions from Generation Tasks

Production Actions record user or Project Agent intent and immutable Artifact Revisions, while Generation Tasks record individual Model attempts and their execution snapshots. HTTP routes and future Project Agent tools will be adapters over the same production modules, allowing the infinite canvas to observe durable Project state without making a frontend socket session the source of truth.
