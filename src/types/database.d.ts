// @db-hash feca77a2c2ec5b6a2989347f982558d5
//该文件由脚本自动生成，请勿手动修改

export interface memories {
  'content': string;
  'createTime': number;
  'embedding'?: string | null;
  'id'?: string;
  'isolationKey': string;
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
  'model'?: string | null;
  'modelName'?: string | null;
  'name'?: string | null;
  'vendorId'?: number | null;
}
export interface o_artStyle {
  'id'?: number;
  'name'?: string | null;
  'styles'?: string | null;
}
export interface o_assets {
  'describe'?: string | null;
  'id'?: number;
  'imageId'?: number | null;
  'name'?: string | null;
  'projectId'?: number | null;
  'prompt'?: string | null;
  'remark'?: string | null;
  'sonId'?: number | null;
  'startTime'?: number | null;
  'state'?: string | null;
  'type'?: string | null;
}
export interface o_chatHistory {
  'data'?: string | null;
  'id'?: number;
  'novel'?: string | null;
  'projectId'?: number | null;
  'type'?: string | null;
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
export interface o_flowData {
  'createTime'?: number | null;
  'id'?: number;
  'name'?: string | null;
}
export interface o_image {
  'assetsId'?: number | null;
  'filePath'?: string | null;
  'id'?: number;
  'projectId'?: number | null;
  'scriptId'?: number | null;
  'state'?: string | null;
  'type'?: string | null;
  'videoId'?: number | null;
}
export interface o_model {
  'apiKey'?: string | null;
  'baseUrl'?: string | null;
  'createTime'?: number | null;
  'id'?: number;
  'index'?: number | null;
  'manufacturer'?: string | null;
  'model'?: string | null;
  'modelType'?: string | null;
  'type'?: string | null;
}
export interface o_myTasks {
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
export interface o_novel {
  'chapter'?: string | null;
  'chapterData'?: string | null;
  'chapterIndex'?: number | null;
  'createTime'?: number | null;
  'id'?: number;
  'projectId'?: number | null;
  'reel'?: string | null;
}
export interface o_outline {
  'data'?: string | null;
  'episode'?: number | null;
  'id'?: number;
  'projectId'?: number | null;
}
export interface o_outlineNovel {
  'id'?: number;
  'novelId'?: number | null;
  'outlineId'?: number | null;
}
export interface o_project {
  'artStyle'?: string | null;
  'createTime'?: number | null;
  'id'?: number | null;
  'intro'?: string | null;
  'name'?: string | null;
  'projectType'?: string | null;
  'type'?: string | null;
  'userId'?: number | null;
  'videoRatio'?: string | null;
}
export interface o_prompts {
  'code'?: string | null;
  'customValue'?: string | null;
  'defaultValue'?: string | null;
  'id'?: number;
  'name'?: string | null;
  'parentCode'?: string | null;
  'type'?: string | null;
}
export interface o_script {
  'content'?: string | null;
  'createTime'?: number | null;
  'id'?: number;
  'name'?: string | null;
  'projectId'?: number | null;
}
export interface o_scriptAssets {
  'assetsId'?: number | null;
  'id'?: number;
  'scriptId'?: number | null;
}
export interface o_scriptOutline {
  'id'?: number;
  'outlineId'?: number | null;
  'scriptId'?: number | null;
}
export interface o_setting {
  'key'?: string | null;
  'value'?: string | null;
}
export interface o_skills {
  'id'?: number;
  'name'?: string | null;
  'startTime'?: number | null;
}
export interface o_storyboard {
  'createTime'?: number | null;
  'id'?: number;
  'name'?: string | null;
}
export interface o_storyboardScript {
  'id'?: number;
  'scriptId'?: number | null;
  'storyboardId'?: number | null;
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
  'code'?: string | null;
  'createTime'?: number | null;
  'icon'?: string | null;
  'id'?: number;
  'inputs'?: string | null;
  'inputValues'?: string | null;
  'models'?: string | null;
  'name'?: string | null;
  'version'?: string | null;
}
export interface o_video {
  'configId'?: number | null;
  'errorReason'?: string | null;
  'filePath'?: string | null;
  'firstFrame'?: string | null;
  'id'?: number;
  'model'?: string | null;
  'prompt'?: string | null;
  'resolution'?: string | null;
  'scriptId'?: number | null;
  'state'?: number | null;
  'storyboardImgs'?: string | null;
  'time'?: number | null;
}
export interface o_videoConfig {
  'aiConfigId'?: number | null;
  'audioEnabled'?: number | null;
  'createTime'?: number | null;
  'duration'?: number | null;
  'endFrame'?: string | null;
  'id'?: number;
  'images'?: string | null;
  'manufacturer'?: string | null;
  'mode'?: string | null;
  'projectId'?: number | null;
  'prompt'?: string | null;
  'resolution'?: string | null;
  'scriptId'?: number | null;
  'selectedResultId'?: number | null;
  'startFrame'?: string | null;
  'updateTime'?: number | null;
}

export interface DB {
  "memories": memories;
  "o_agentDeploy": o_agentDeploy;
  "o_artStyle": o_artStyle;
  "o_assets": o_assets;
  "o_chatHistory": o_chatHistory;
  "o_event": o_event;
  "o_eventChapter": o_eventChapter;
  "o_flowData": o_flowData;
  "o_image": o_image;
  "o_model": o_model;
  "o_myTasks": o_myTasks;
  "o_novel": o_novel;
  "o_outline": o_outline;
  "o_outlineNovel": o_outlineNovel;
  "o_project": o_project;
  "o_prompts": o_prompts;
  "o_script": o_script;
  "o_scriptAssets": o_scriptAssets;
  "o_scriptOutline": o_scriptOutline;
  "o_setting": o_setting;
  "o_skills": o_skills;
  "o_storyboard": o_storyboard;
  "o_storyboardScript": o_storyboardScript;
  "o_tasks": o_tasks;
  "o_user": o_user;
  "o_vendorConfig": o_vendorConfig;
  "o_video": o_video;
  "o_videoConfig": o_videoConfig;
}
