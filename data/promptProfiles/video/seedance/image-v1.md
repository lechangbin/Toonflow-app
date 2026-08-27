---
id: seedance/image-v1
schemaVersion: 1
capabilityId: image-to-video
defaultStrategy: standard-with-guidance
draftSections: [subject, motion, scene, camera, lighting, style, continuity, audio, constraints]
attribution: seedance-20@6.7.0 (MIT)
---
# Seedance 2.0 image-to-video guidance

The source image owns the opening visual state. Text carries the motion delta, endpoint, continuity risks, one camera move, motivated light, and requested sound. State what remains stable and do not repeat visible source detail or invent provider-specific reference tags.
