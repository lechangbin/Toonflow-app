# Use provider-independent Video Capabilities

Video Models declare complete, provider-independent Video Capabilities for inputs, reference roles, Prompt Profiles, native audio, and output presets; Video Tracks persist the selected capability and explicit input roles, while Vendor adapters only map validated commands to provider requests. This replaces the overloaded `mode` field and model-name or array-order inference so Agnes keyframes, strict first/last-frame generation, and future multimodal references remain distinct and testable.
