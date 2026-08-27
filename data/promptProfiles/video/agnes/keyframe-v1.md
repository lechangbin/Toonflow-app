---
id: agnes/keyframe-v1
schemaVersion: 1
capabilityId: keyframe-to-video
defaultStrategy: standard-with-guidance
draftSections: [subject, motion, scene, camera, lighting, style, continuity, transition, audio, constraints]
attribution: seedance-20@6.7.0 craft principles (MIT)
---
# Agnes keyframe guidance

Treat first, optional intermediate, and last frames as explicit adjacent temporal targets. With two frames, describe first-to-last motion. With three, describe first-to-intermediate and intermediate-to-last progression without inferring roles from upload order. Preserve identity and camera continuity, name one physical action path, and make the final frame the actual endpoint. Audio is native and always generated, but never invent dialogue, music, or sound effects.
