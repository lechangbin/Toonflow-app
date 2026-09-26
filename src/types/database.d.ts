// @db-hash 8dfe3dc75ad64f433a8d201ff805e2fc
//该文件由脚本自动生成，请勿手动修改

export interface memories {
  'content': string;
  'createTime': number;
  'embedding'?: string | null;
  'id'?: string;
  'isolationKey': string;
  'name'?: string | null;
  'relatedMessageIds'?: string | null;
  'role'?: string | null;
  'summarized'?: number | null;
  'type': string;
}
export interface o_agentContextBundle {
  'attemptId': string;
  'createdAt': number;
  'id'?: string;
  'manifestHash': string;
  'manifestJson': string;
  'messagesJson': string;
  'predecessorBundleId'?: string | null;
  'promptHash': string;
  'runId': string;
  'schemaVersion': string;
  'stepId': string;
}
export interface o_agentDeploy {
  'desc'?: string | null;
  'disabled'?: boolean | null;
  'id'?: number;
  'key'?: string | null;
  'maxOutputTokens'?: number | null;
  'model'?: string | null;
  'modelName'?: string | null;
  'name'?: string | null;
  'temperature'?: number | null;
  'vendorId'?: string | null;
}
export interface o_agentEvidenceDeletionPermit {
  'runId'?: string;
}
export interface o_agentImageArtifact {
  'assetId': number;
  'contentHash': string;
  'createdAt': number;
  'id'?: string;
  'imageId'?: number | null;
  'mediaPath'?: string | null;
  'status': string;
  'updatedAt': number;
  'vendorRequestId': string;
}
export interface o_agentImageQuotePolicy {
  'currency': string;
  'estimatedMaxCostMicros': number;
  'id'?: string;
  'modelId': string;
  'projectId': number;
  'resolution': string;
  'revision': number;
  'updatedAt': number;
  'updatedByUserId': number;
  'vendorId': string;
}
export interface o_agentProjectCapabilityGrant {
  'capability'?: string;
  'changedByUserId': number;
  'projectId'?: number;
  'state': string;
  'updatedAt': number;
  'version': number;
}
export interface o_agentProjectMemory {
  'confidence': string;
  'content': string;
  'contentHash': string;
  'createdAt': number;
  'endCodePoint': number;
  'id'?: string;
  'kind': string;
  'projectId': number;
  'revision': string;
  'revocationCommandId'?: string | null;
  'revokedAt'?: number | null;
  'role': string;
  'scriptId'?: number | null;
  'sourceOutputHash': string;
  'sourceOutputId': string;
  'sourceRunId': string;
  'sourceStepId': string;
  'startCodePoint': number;
  'status': string;
}
export interface o_agentRun {
  'allowedActions': string;
  'attentionReason'?: string | null;
  'cancellationCommandId'?: string | null;
  'cancellationRequestedAt'?: number | null;
  'clientRequestId': string;
  'completedAt'?: number | null;
  'createdAt': number;
  'failureDiagnostic'?: string | null;
  'fence'?: number;
  'id'?: string;
  'input': string;
  'lastCommittedStepId'?: string | null;
  'leaseEpoch'?: string | null;
  'leaseExpiresAt'?: number | null;
  'leaseOwnerId'?: string | null;
  'projectId': number;
  'requestFingerprint': string;
  'role': string;
  'scope': string;
  'scriptId'?: number | null;
  'startedAt'?: number | null;
  'status': string;
  'updatedAt': number;
  'version': number;
  'waitingReason'?: string | null;
}
export interface o_agentRunAttempt {
  'completedAt'?: number | null;
  'createdAt': number;
  'id'?: string;
  'invocationFingerprint'?: string | null;
  'ordinal': number;
  'predecessorAttemptId'?: string | null;
  'reason': string;
  'resolvedTarget'?: string | null;
  'runId': string;
  'startedAt'?: number | null;
  'status': string;
  'stepId': string;
}
export interface o_agentRunCheckpoint {
  'attemptId'?: string | null;
  'createdAt': number;
  'id'?: string;
  'kind': string;
  'lastCommittedStepId'?: string | null;
  'payload': string;
  'payloadHash': string;
  'predecessorCheckpointId'?: string | null;
  'runId': string;
  'runVersion': number;
  'schemaVersion': string;
  'sequence': number;
  'stepId'?: string | null;
}
export interface o_agentRunCommand {
  'clientCommandId': string;
  'createdAt': number;
  'expectedVersion': number;
  'id'?: string;
  'inputFingerprint': string;
  'kind': string;
  'resultVersion': number;
  'runId': string;
}
export interface o_agentRunOutput {
  'content': string;
  'contentHash': string;
  'createdAt': number;
  'id'?: string;
  'kind': string;
  'runId': string;
  'schemaVersion': string;
  'stepId': string;
}
export interface o_agentRunSkillBinding {
  'boundAt': number;
  'contentHash': string;
  'manifestHash': string;
  'revisionId': string;
  'runId'?: string;
  'skillId'?: string;
}
export interface o_agentRunSkillResolution {
  'boundAt': number;
  'planHash': string;
  'planJson': string;
  'runId'?: string;
  'schemaVersion': string;
}
export interface o_agentRunStep {
  'completedAt'?: number | null;
  'id'?: string;
  'kind': string;
  'logicalTarget': string;
  'ordinal': number;
  'promptFingerprint': string;
  'resolvedTarget'?: string | null;
  'runId': string;
  'startedAt'?: number | null;
  'status': string;
}
export interface o_agentSkillBinding {
  'activeRevisionId': string;
  'skillId'?: string;
  'updatedAt': number;
  'version': number;
}
export interface o_agentSkillDefinition {
  'createdAt': number;
  'description': string;
  'id'?: string;
  'name': string;
}
export interface o_agentSkillPermissionDecision {
  'createdAt': number;
  'decisionHash': string;
  'decisionJson': string;
  'id'?: string;
  'operationId': string;
  'runId': string;
  'skillId': string;
  'skillRevisionId': string;
  'toolName': string;
}
export interface o_agentSkillResourceAccess {
  'contentHash': string;
  'createdAt': number;
  'id'?: string;
  'resourceId': string;
  'runId': string;
  'skillId': string;
  'skillRevisionId': string;
}
export interface o_agentSkillResourceRevision {
  'content': string;
  'contentHash': string;
  'createdAt': number;
  'mediaType': string;
  'resourceId'?: string;
  'skillRevisionId'?: string;
}
export interface o_agentSkillRevision {
  'content': string;
  'contentHash': string;
  'createdAt': number;
  'id'?: string;
  'manifestHash': string;
  'manifestJson': string;
  'publishedAt'?: number | null;
  'semanticVersion': string;
  'skillId': string;
  'status': string;
}
export interface o_agentSkillRevisionPolicy {
  'revisionId'?: string;
  'state': string;
  'updatedAt': number;
  'version': number;
}
export interface o_agentSkillRouteDecision {
  'createdAt': number;
  'decisionHash': string;
  'decisionJson': string;
  'id'?: string;
  'intent': string;
  'projectId': number;
  'queryHash': string;
  'runId': string;
  'schemaVersion': string;
}
export interface o_agentToolApproval {
  'contractHash': string;
  'createdAt': number;
  'decidedAt'?: number | null;
  'decidedByUserId'?: number | null;
  'decisionCommandId'?: string | null;
  'decisionExpectedVersion'?: number | null;
  'decisionKind'?: string | null;
  'expiresAt': number;
  'id'?: string;
  'operationId': string;
  'payloadHash': string;
  'payloadJson': string;
  'previewJson': string;
  'receiptId': string;
  'runId': string;
  'status': string;
  'targetStateHash': string;
  'toolRevision': string;
}
export interface o_agentToolCall {
  'approvalId': string;
  'attemptId': string;
  'createdAt': number;
  'id'?: string;
  'inputHash': string;
  'receiptId': string;
  'runId': string;
  'status': string;
  'stepId': string;
  'toolName': string;
  'toolRevision': string;
  'updatedAt': number;
}
export interface o_agentToolDefinition {
  'contractHash': string;
  'createdAt': number;
  'id'?: string;
  'name': string;
  'policy': string;
  'revision': string;
}
export interface o_agentToolReceipt {
  'createdAt': number;
  'diagnostic'?: string | null;
  'id'?: string;
  'inputHash': string;
  'operationId': string;
  'outputHash'?: string | null;
  'outputJson'?: string | null;
  'runId': string;
  'status': string;
  'toolName': string;
  'toolRevision': string;
  'updatedAt': number;
}
export interface o_agentTrace {
  'attemptId'?: string | null;
  'createdAt': number;
  'diagnostic'?: string | null;
  'diagnosticSchemaVersion'?: string | null;
  'eventType': string;
  'id'?: string;
  'imageArtifactId'?: string | null;
  'videoVendorRequestId'?: string | null;
  'videoArtifactId'?: string | null;
  'predecessorTraceId'?: string | null;
  'runId': string;
  'runStatus'?: string | null;
  'sequence': number;
  'stepId'?: string | null;
  'stepStatus'?: string | null;
  'toolCallId'?: string | null;
  'toolReceiptId'?: string | null;
  'vendorRequestId'?: string | null;
}
export interface o_agentVendorRequest {
  'artifactHash'?: string | null;
  'assetId': number;
  'cancellationRequestedAt'?: number | null;
  'createdAt': number;
  'currency': string;
  'estimatedMaxCostMicros': number;
  'id'?: string;
  'imageId'?: number | null;
  'maxCalls': number;
  'modelId': string;
  'projectId': number;
  'providerTaskId'?: string | null;
  'requestId': string;
  'resolution': string;
  'runId': string;
  'scopeHash': string;
  'status': string;
  'toolCallId': string;
  'updatedAt': number;
  'vendorId': string;
  'version': number;
}
export interface o_agentVideoQuotePolicy {
  'currency': string;
  'estimatedMaxCostMicros': number;
  'id'?: string;
  'projectId': number;
  'revision': number;
  'scopeJson': string;
  'scopeKey': string;
  'updatedAt': number;
  'updatedByUserId': number;
}
export interface o_agentVideoArtifact {
  'contentHash': string;
  'createdAt': number;
  'id'?: string;
  'mediaPath': string;
  'status': string;
  'trackId': number;
  'updatedAt': number;
  'vendorRequestId': string;
}
export interface o_agentVideoVendorRequest {
  'cancellationRequestedAt'?: number | null;
  'commandHash': string;
  'createdAt': number;
  'currency': string;
  'estimatedMaxCostMicros': number;
  'id'?: string;
  'modelId': string;
  'projectId': number;
  'providerTaskId'?: string | null;
  'requestId': string;
  'runId': string;
  'scopeHash': string;
  'status': string;
  'toolCallId': string;
  'trackId': number;
  'updatedAt': number;
  'vendorId': string;
  'version': number;
}
export interface o_agentWorkData {
  'createTime'?: number | null;
  'data'?: string | null;
  'episodesId'?: number | null;
  'id'?: number;
  'key'?: string | null;
  'projectId'?: number | null;
  'updateTime'?: number | null;
}
export interface o_artifactRevision {
  'actionId': number;
  'createdAt': number;
  'generationTaskId': number;
  'id'?: number;
  'revision': number;
  'status': string;
  'videoId': number;
  'videoTrackId': number;
}
export interface o_artStyle {
  'fileUrl'?: string | null;
  'id'?: number;
  'label'?: string | null;
  'name'?: string | null;
  'prompt'?: string | null;
}
export interface o_assetIdentity {
  'assetsId': number;
  'createTime'?: number | null;
  'id'?: number;
  'identity'?: string | null;
  'projectId'?: number | null;
  'schemaVersion': number;
  'updateTime'?: number | null;
}
export interface o_assetPromptRecord {
  'additionalRequirements'?: string | null;
  'assetBrief'?: string | null;
  'assetsId': number;
  'batchContext'?: string | null;
  'contextHash'?: string | null;
  'createTime'?: number | null;
  'generationPrompt'?: string | null;
  'id'?: number;
  'language'?: string | null;
  'modelProfile'?: string | null;
  'projectId'?: number | null;
  'referenceHash'?: string | null;
  'repairNotes'?: string | null;
  'scriptId'?: number | null;
  'skillVersion'?: string | null;
  'templateHash'?: string | null;
  'updateTime'?: number | null;
  'validationState'?: string | null;
}
export interface o_assetReference {
  'analysisState'?: string | null;
  'assetsId'?: number | null;
  'createTime'?: number | null;
  'description'?: string | null;
  'descriptionSource'?: string | null;
  'exclusions'?: string | null;
  'id'?: number;
  'mediaMime'?: string | null;
  'mediaPath'?: string | null;
  'orderIndex'?: number | null;
  'projectId'?: number | null;
  'requiredTransfers'?: string | null;
  'updateTime'?: number | null;
  'visualRole'?: string | null;
}
export interface o_assets {
  'assetsId'?: number | null;
  'audioBindState'?: number | null;
  'describe'?: string | null;
  'flowId'?: number | null;
  'id'?: number;
  'imageId'?: number | null;
  'name'?: string | null;
  'projectId'?: number | null;
  'prompt'?: string | null;
  'promptErrorReason'?: string | null;
  'promptState'?: string | null;
  'remark'?: string | null;
  'scriptId'?: number | null;
  'startTime'?: number | null;
  'type'?: string | null;
}
export interface o_assets2Storyboard {
  'assetId'?: number;
  'storyboardId'?: number;
}
export interface o_assetsRole2Audio {
  'assetsAudioId'?: number;
  'assetsRoleId'?: number;
}
export interface o_derivedChangeInstruction {
  'assetsId': number;
  'createTime'?: number | null;
  'id'?: number;
  'instruction'?: string | null;
  'projectId'?: number | null;
  'revision'?: number | null;
  'source'?: string | null;
  'updateTime'?: number | null;
}
export interface o_event {
  'createTime'?: number | null;
  'detail'?: string | null;
  'id'?: number;
  'name'?: string | null;
}
export interface o_eventChapter {
  'eventId'?: number | null;
  'id'?: number;
  'novelId'?: number | null;
}
export interface o_generationTask {
  'actionId': number;
  'artifactRevisionId'?: number | null;
  'capabilityId': string;
  'commandSnapshot': string;
  'completedAt'?: number | null;
  'error'?: string | null;
  'id'?: number;
  'modelId': string;
  'projectId': number;
  'promptRevisionId': number;
  'providerTaskSnapshot'?: string | null;
  'startedAt': number;
  'status': string;
  'vendorId': string;
  'videoTrackId': number;
}
export interface o_image {
  'assetsId'?: number | null;
  'errorReason'?: string | null;
  'filePath'?: string | null;
  'id'?: number;
  'model'?: string | null;
  'resolution'?: string | null;
  'state'?: string | null;
  'type'?: string | null;
}
export interface o_imageFlow {
  'flowData': string;
  'id'?: number;
}
export interface o_modelPrompt {
  'fileName'?: string | null;
  'id'?: number;
  'model'?: string | null;
  'path'?: string | null;
  'vendorId'?: string | null;
}
export interface o_novel {
  'chapter'?: string | null;
  'chapterData'?: string | null;
  'chapterIndex'?: number | null;
  'createTime'?: number | null;
  'errorReason'?: string | null;
  'event'?: string | null;
  'eventState'?: number | null;
  'id'?: number;
  'projectId'?: number | null;
  'reel'?: string | null;
}
export interface o_productionAction {
  'actionType': string;
  'completedAt'?: number | null;
  'createdAt': number;
  'id'?: number;
  'projectId': number;
  'requestedBy': string;
  'status': string;
}
export interface o_project {
  'artStyle'?: string | null;
  'createTime'?: number | null;
  'directorManual'?: string | null;
  'id'?: number | null;
  'imageModel'?: string | null;
  'imageQuality'?: string | null;
  'intro'?: string | null;
  'name'?: string | null;
  'projectType'?: string | null;
  'type'?: string | null;
  'userId'?: number | null;
  'videoCapabilityId'?: string | null;
  'videoModelId'?: string | null;
  'videoOutputPresetId'?: string | null;
  'videoRatio'?: string | null;
  'videoVendorId'?: string | null;
}
export interface o_prompt {
  'data'?: string | null;
  'id'?: number;
  'name'?: string | null;
  'type'?: string | null;
  'useData'?: string | null;
}
export interface o_promptRevision {
  'brief'?: string | null;
  'createdAt': number;
  'draft'?: string | null;
  'id'?: number;
  'profileId': string;
  'projectId': number;
  'renderedPrompt': string;
  'status': string;
  'strategy': string;
  'videoTrackId': number;
}
export interface o_script {
  'content'?: string | null;
  'createTime'?: number | null;
  'errorReason'?: string | null;
  'extractState'?: number | null;
  'id'?: number;
  'name'?: string | null;
  'projectId'?: number | null;
}
export interface o_scriptAssets {
  'assetId'?: number;
  'scriptId'?: number;
}
export interface o_setting {
  'key'?: string | null;
  'value'?: string | null;
}
export interface o_skillAttribution {
  'attribution'?: string;
  'skillId'?: string;
}
export interface o_skillList {
  'createTime': number;
  'description': string;
  'embedding'?: string | null;
  'id'?: string;
  'md5': string;
  'name': string;
  'path': string;
  'state': number;
  'type': string;
  'updateTime': number;
}
export interface o_storyboard {
  'createTime'?: number | null;
  'duration'?: string | null;
  'filePath'?: string | null;
  'flowId'?: number | null;
  'id'?: number;
  'index'?: number | null;
  'projectId'?: number | null;
  'prompt'?: string | null;
  'reason'?: string | null;
  'scriptId'?: number | null;
  'shouldGenerateImage'?: number | null;
  'state'?: string | null;
  'track'?: string | null;
  'trackId'?: number | null;
  'videoDesc'?: string | null;
}
export interface o_tasks {
  'describe'?: string | null;
  'id'?: number;
  'model'?: string | null;
  'projectId'?: number | null;
  'reason'?: string | null;
  'relatedObjects'?: string | null;
  'startTime'?: number | null;
  'state'?: string | null;
  'taskClass'?: string | null;
}
export interface o_user {
  'id'?: number;
  'name'?: string | null;
  'password'?: string | null;
}
export interface o_vendorConfig {
  'enable'?: number | null;
  'id'?: string;
  'inputValues'?: string | null;
  'models'?: string | null;
}
export interface o_video {
  'artifactRevisionId'?: number | null;
  'errorReason'?: string | null;
  'filePath'?: string | null;
  'generationTaskId'?: number | null;
  'id'?: number;
  'projectId'?: number | null;
  'scriptId'?: number | null;
  'state'?: string | null;
  'time'?: number | null;
  'videoTrackId'?: number | null;
}
export interface o_videoTrack {
  'audioSelection'?: string | null;
  'capabilityId'?: string | null;
  'duration'?: number | null;
  'id'?: number;
  'inputRefs'?: string | null;
  'modelId'?: string | null;
  'outputSelection'?: string | null;
  'projectId'?: number | null;
  'promptRevisionId'?: number | null;
  'reason'?: string | null;
  'scriptId'?: number | null;
  'selectVideoId'?: number | null;
  'state'?: string | null;
  'vendorId'?: string | null;
  'videoId'?: number | null;
}

export interface DB {
  "memories": memories;
  "o_agentContextBundle": o_agentContextBundle;
  "o_agentDeploy": o_agentDeploy;
  "o_agentEvidenceDeletionPermit": o_agentEvidenceDeletionPermit;
  "o_agentImageArtifact": o_agentImageArtifact;
  "o_agentImageQuotePolicy": o_agentImageQuotePolicy;
  "o_agentProjectCapabilityGrant": o_agentProjectCapabilityGrant;
  "o_agentProjectMemory": o_agentProjectMemory;
  "o_agentRun": o_agentRun;
  "o_agentRunAttempt": o_agentRunAttempt;
  "o_agentRunCheckpoint": o_agentRunCheckpoint;
  "o_agentRunCommand": o_agentRunCommand;
  "o_agentRunOutput": o_agentRunOutput;
  "o_agentRunSkillBinding": o_agentRunSkillBinding;
  "o_agentRunSkillResolution": o_agentRunSkillResolution;
  "o_agentRunStep": o_agentRunStep;
  "o_agentSkillBinding": o_agentSkillBinding;
  "o_agentSkillDefinition": o_agentSkillDefinition;
  "o_agentSkillPermissionDecision": o_agentSkillPermissionDecision;
  "o_agentSkillResourceAccess": o_agentSkillResourceAccess;
  "o_agentSkillResourceRevision": o_agentSkillResourceRevision;
  "o_agentSkillRevision": o_agentSkillRevision;
  "o_agentSkillRevisionPolicy": o_agentSkillRevisionPolicy;
  "o_agentSkillRouteDecision": o_agentSkillRouteDecision;
  "o_agentToolApproval": o_agentToolApproval;
  "o_agentToolCall": o_agentToolCall;
  "o_agentToolDefinition": o_agentToolDefinition;
  "o_agentToolReceipt": o_agentToolReceipt;
  "o_agentTrace": o_agentTrace;
  "o_agentVendorRequest": o_agentVendorRequest;
  "o_agentVideoQuotePolicy": o_agentVideoQuotePolicy;
  "o_agentVideoArtifact": o_agentVideoArtifact;
  "o_agentVideoVendorRequest": o_agentVideoVendorRequest;
  "o_agentWorkData": o_agentWorkData;
  "o_artifactRevision": o_artifactRevision;
  "o_artStyle": o_artStyle;
  "o_assetIdentity": o_assetIdentity;
  "o_assetPromptRecord": o_assetPromptRecord;
  "o_assetReference": o_assetReference;
  "o_assets": o_assets;
  "o_assets2Storyboard": o_assets2Storyboard;
  "o_assetsRole2Audio": o_assetsRole2Audio;
  "o_derivedChangeInstruction": o_derivedChangeInstruction;
  "o_event": o_event;
  "o_eventChapter": o_eventChapter;
  "o_generationTask": o_generationTask;
  "o_image": o_image;
  "o_imageFlow": o_imageFlow;
  "o_modelPrompt": o_modelPrompt;
  "o_novel": o_novel;
  "o_productionAction": o_productionAction;
  "o_project": o_project;
  "o_prompt": o_prompt;
  "o_promptRevision": o_promptRevision;
  "o_script": o_script;
  "o_scriptAssets": o_scriptAssets;
  "o_setting": o_setting;
  "o_skillAttribution": o_skillAttribution;
  "o_skillList": o_skillList;
  "o_storyboard": o_storyboard;
  "o_tasks": o_tasks;
  "o_user": o_user;
  "o_vendorConfig": o_vendorConfig;
  "o_video": o_video;
  "o_videoTrack": o_videoTrack;
}
