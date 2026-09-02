// @db-hash b28b366704f66c6908e01789c9aa6bfd
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
  'type'?: string | null;
  'vendorId'?: string | null;
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
  "o_agentDeploy": o_agentDeploy;
  "o_agentWorkData": o_agentWorkData;
  "o_artifactRevision": o_artifactRevision;
  "o_artStyle": o_artStyle;
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
