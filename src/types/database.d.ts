<<<<<<< HEAD
// @db-hash 6fa5017e455bc367c9c902ba574d11b4
=======
// @db-hash 4ab04ca9077c96cd2ff345a886cbae8f
>>>>>>> 753bd4c (修补107bug)
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
  'model'?: string | null;
  'modelName'?: string | null;
  'name'?: string | null;
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
export interface o_artStyle {
  'fileUrl'?: string | null;
  'id'?: number;
  'label'?: string | null;
  'name'?: string | null;
  'prompt'?: string | null;
}
export interface o_assets {
<<<<<<< HEAD
  'assetsId'?: number | null;
  'describe'?: string | null;
  'flowId'?: number | null;
=======
  'describe'?: string | null;
  'filePath'?: string | null;
>>>>>>> 753bd4c (修补107bug)
  'id'?: number;
  'imageId'?: number | null;
  'name'?: string | null;
<<<<<<< HEAD
=======
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
>>>>>>> 753bd4c (修补107bug)
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
<<<<<<< HEAD
export interface o_imageFlow {
  'flowData': string;
  'id'?: number;
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
  'directorManual'?: string | null;
  'id'?: number | null;
  'imageModel'?: string | null;
  'imageQuality'?: string | null;
  'intro'?: string | null;
  'mode'?: string | null;
  'name'?: string | null;
  'projectType'?: string | null;
  'type'?: string | null;
  'userId'?: number | null;
  'videoModel'?: string | null;
  'videoRatio'?: string | null;
}
export interface o_prompt {
  'data'?: string | null;
  'id'?: number;
  'name'?: string | null;
=======
export interface o_model {
  'apiKey'?: string | null;
  'baseUrl'?: string | null;
  'createTime'?: number | null;
  'id'?: number;
  'index'?: number | null;
  'manufacturer'?: string | null;
  'model'?: string | null;
  'modelType'?: string | null;
>>>>>>> 753bd4c (修补107bug)
  'type'?: string | null;
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
<<<<<<< HEAD
=======
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
  'id'?: number;
  'imageModel'?: string | null;
  'languageModel'?: string | null;
  'projectId'?: number | null;
  'tokenKey'?: string | null;
  'userId'?: number | null;
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
>>>>>>> 753bd4c (修补107bug)
export interface o_user {
  'id'?: number;
  'name'?: string | null;
  'password'?: string | null;
}
export interface o_vendorConfig {
  'author'?: string | null;
  'code'?: string | null;
  'createTime'?: number | null;
  'description'?: string | null;
  'enable'?: number | null;
  'icon'?: string | null;
  'id'?: string;
  'inputs'?: string | null;
  'inputValues'?: string | null;
  'models'?: string | null;
  'name'?: string | null;
}
export interface o_video {
<<<<<<< HEAD
=======
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
export interface t_aiModelMap {
  'configId'?: number | null;
  'id'?: number;
  'key'?: string | null;
  'name'?: string | null;
}
export interface t_artStyle {
  'id'?: number;
  'name'?: string | null;
  'styles'?: string | null;
}
export interface t_assets {
  'duration'?: string | null;
  'episode'?: string | null;
  'filePath'?: string | null;
  'id'?: number;
  'intro'?: string | null;
  'name'?: string | null;
  'projectId'?: number | null;
  'prompt'?: string | null;
  'remark'?: string | null;
  'scriptId'?: number | null;
  'segmentId'?: number | null;
  'shotIndex'?: number | null;
  'state'?: string | null;
  'type'?: string | null;
  'videoPrompt'?: string | null;
}
export interface t_chatHistory {
  'data'?: string | null;
  'id'?: number;
  'novel'?: string | null;
  'projectId'?: number | null;
  'type'?: string | null;
}
export interface t_config {
  'apiKey'?: string | null;
  'baseUrl'?: string | null;
  'createTime'?: number | null;
  'id'?: number;
  'manufacturer'?: string | null;
  'model'?: string | null;
  'modelType'?: string | null;
  'type'?: string | null;
  'userId'?: number | null;
}
export interface t_image {
  'assetsId'?: number | null;
  'filePath'?: string | null;
  'id'?: number;
  'projectId'?: number | null;
  'scriptId'?: number | null;
  'state'?: string | null;
  'type'?: string | null;
  'videoId'?: number | null;
}
export interface t_imageModel {
  'grid'?: number | null;
  'id'?: number;
  'manufacturer'?: string | null;
  'model'?: string | null;
  'type'?: string | null;
}
export interface t_novel {
  'chapter'?: string | null;
  'chapterData'?: string | null;
  'chapterIndex'?: number | null;
  'createTime'?: number | null;
  'id'?: number;
  'projectId'?: number | null;
  'reel'?: string | null;
}
export interface t_outline {
  'data'?: string | null;
  'episode'?: number | null;
  'id'?: number;
  'projectId'?: number | null;
}
export interface t_project {
  'artStyle'?: string | null;
  'createTime'?: number | null;
  'id'?: number | null;
  'intro'?: string | null;
  'name'?: string | null;
  'type'?: string | null;
  'userId'?: number | null;
  'videoRatio'?: string | null;
}
export interface t_prompts {
  'code'?: string | null;
  'customValue'?: string | null;
  'defaultValue'?: string | null;
  'id'?: number;
  'name'?: string | null;
  'parentCode'?: string | null;
  'type'?: string | null;
}
export interface t_script {
  'content'?: string | null;
  'id'?: number;
  'name'?: string | null;
  'outlineId'?: number | null;
  'projectId'?: number | null;
}
export interface t_setting {
  'id'?: number;
  'imageModel'?: string | null;
  'languageModel'?: string | null;
  'projectId'?: number | null;
  'tokenKey'?: string | null;
  'userId'?: number | null;
}
export interface t_storyline {
  'content'?: string | null;
  'id'?: number;
  'name'?: string | null;
  'novelIds'?: string | null;
  'projectId'?: number | null;
}
export interface t_taskList {
  'endTime'?: string | null;
  'id'?: number;
  'name'?: string | null;
  'projectName'?: number | null;
  'prompt'?: string | null;
  'startTime'?: string | null;
  'state'?: string | null;
}
export interface t_textModel {
  'id'?: number;
  'image'?: number | null;
  'manufacturer'?: string | null;
  'model'?: string | null;
  'responseFormat'?: string | null;
  'think'?: number | null;
  'tool'?: number | null;
}
export interface t_user {
  'id'?: number;
  'name'?: string | null;
  'password'?: string | null;
}
export interface t_video {
  'aiConfigId'?: number | null;
  'configId'?: number | null;
>>>>>>> 753bd4c (修补107bug)
  'errorReason'?: string | null;
  'filePath'?: string | null;
  'id'?: number;
  'projectId'?: number | null;
  'scriptId'?: number | null;
  'state'?: string | null;
  'time'?: number | null;
  'videoTrackId'?: number | null;
}
export interface o_videoTrack {
  'duration'?: number | null;
  'id'?: number;
  'projectId'?: number | null;
  'prompt'?: string | null;
  'reason'?: string | null;
  'scriptId'?: number | null;
  'selectVideoId'?: number | null;
  'state'?: string | null;
  'videoId'?: number | null;
}

export interface DB {
  "memories": memories;
  "o_agentDeploy": o_agentDeploy;
  "o_agentWorkData": o_agentWorkData;
  "o_artStyle": o_artStyle;
  "o_assets": o_assets;
  "o_assets2Storyboard": o_assets2Storyboard;
  "o_event": o_event;
  "o_eventChapter": o_eventChapter;
  "o_image": o_image;
  "o_imageFlow": o_imageFlow;
  "o_novel": o_novel;
  "o_outline": o_outline;
  "o_outlineNovel": o_outlineNovel;
  "o_project": o_project;
  "o_prompt": o_prompt;
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
<<<<<<< HEAD
  "o_videoTrack": o_videoTrack;
=======
  "o_videoConfig": o_videoConfig;
  "t_aiModelMap": t_aiModelMap;
  "t_artStyle": t_artStyle;
  "t_assets": t_assets;
  "t_chatHistory": t_chatHistory;
  "t_config": t_config;
  "t_image": t_image;
  "t_imageModel": t_imageModel;
  "t_novel": t_novel;
  "t_outline": t_outline;
  "t_project": t_project;
  "t_prompts": t_prompts;
  "t_script": t_script;
  "t_setting": t_setting;
  "t_storyline": t_storyline;
  "t_taskList": t_taskList;
  "t_textModel": t_textModel;
  "t_user": t_user;
  "t_video": t_video;
  "t_videoConfig": t_videoConfig;
  "t_videoModel": t_videoModel;
>>>>>>> 753bd4c (修补107bug)
}
