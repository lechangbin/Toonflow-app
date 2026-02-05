type VideoGenerationType =
  | "singleImage" // 单图
  | "startEndRequired" // 首尾帧（两张都得有）
  | "endFrameOptional" // 首尾帧（尾帧可选）
  | "startFrameOptional" // 首尾帧（首帧可选）
  | "multiImage" // 多图模式
  | "reference" // 参考图模式
  | "text"; // 文本生视频

interface DurationResolutionMap {
  duration: number[];
  resolution: `${number}p`[];
}
interface Owned {
  manufacturer: string;
  model: string;
  durationResolutionMap: DurationResolutionMap[];
  aspectRatio: `${number}:${number}`[];
  type: VideoGenerationType[];
  audio: boolean;
}

const modelList: Owned[] = [
  // ================== 火山引擎/豆包系列 ==================
  // doubao-seedance-1-5-pro 文生视频
  {
    manufacturer: "volcengine",
    model: "doubao-seedance-1-5-pro-251215",
    durationResolutionMap: [{ duration: [4, 5, 6, 7, 8, 9, 10, 11, 12], resolution: ["480p", "720p", "1080p"] }],
    aspectRatio: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"],
    type: ["text"],
    audio: true,
  },
  // doubao-seedance-1-5-pro 图生视频
  {
    manufacturer: "volcengine",
    model: "doubao-seedance-1-5-pro-251215",
    durationResolutionMap: [{ duration: [4, 5, 6, 7, 8, 9, 10, 11, 12], resolution: ["480p", "720p", "1080p"] }],
    aspectRatio: [],
    type: ["endFrameOptional"],
    audio: true,
  },
  // doubao-seedance-1-0-pro 文生视频
  {
    manufacturer: "volcengine",
    model: "doubao-seedance-1-0-pro-250528",
    durationResolutionMap: [{ duration: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], resolution: ["480p", "720p", "1080p"] }],
    aspectRatio: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"],
    type: ["text"],
    audio: false,
  },
  // doubao-seedance-1-0-pro 图生视频
  {
    manufacturer: "volcengine",
    model: "doubao-seedance-1-0-pro-250528",
    durationResolutionMap: [{ duration: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], resolution: ["480p", "720p", "1080p"] }],
    aspectRatio: [],
    type: ["endFrameOptional"],
    audio: false,
  },
  // doubao-seedance-1-0-pro-fast 文生视频
  {
    manufacturer: "volcengine",
    model: "doubao-seedance-1-0-pro-fast-251015",
    durationResolutionMap: [{ duration: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], resolution: ["480p", "720p", "1080p"] }],
    aspectRatio: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"],
    type: ["text"],
    audio: false,
  },
  // doubao-seedance-1-0-pro-fast 图生视频
  {
    manufacturer: "volcengine",
    model: "doubao-seedance-1-0-pro-fast-251015",
    durationResolutionMap: [{ duration: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], resolution: ["480p", "720p", "1080p"] }],
    aspectRatio: [],
    type: ["singleImage"],
    audio: false,
  },
  // doubao-seedance-1-0-lite-i2v 图生视频（仅支持图片模式）
  {
    manufacturer: "volcengine",
    model: "doubao-seedance-1-0-lite-i2v-250428",
    durationResolutionMap: [{ duration: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], resolution: ["480p", "720p", "1080p"] }],
    aspectRatio: [],
    type: ["endFrameOptional", "reference"],
    audio: false,
  },
  // doubao-seedance-1-0-lite-t2v 文生视频（仅支持文本模式）
  {
    manufacturer: "volcengine",
    model: "doubao-seedance-1-0-lite-t2v-250428",
    durationResolutionMap: [{ duration: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], resolution: ["480p", "720p", "1080p"] }],
    aspectRatio: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"],
    type: ["text"],
    audio: false,
  },
  // ================== 可灵系列 ==================
  // kling-v1(STD) 文生视频
  {
    manufacturer: "kling",
    model: "kling-v1(STD)",
    durationResolutionMap: [{ duration: [5, 10], resolution: ["720p"] }],
    aspectRatio: ["16:9", "1:1", "9:16"],
    type: ["text"],
    audio: false,
  },
  // kling-v1(STD) 图生视频
  {
    manufacturer: "kling",
    model: "kling-v1(STD)",
    durationResolutionMap: [{ duration: [5, 10], resolution: ["720p"] }],
    aspectRatio: [],
    type: ["startEndRequired"],
    audio: false,
  },
  // kling-v1(PRO) 文生视频
  {
    manufacturer: "kling",
    model: "kling-v1(PRO)",
    durationResolutionMap: [{ duration: [5, 10], resolution: ["1080p"] }],
    aspectRatio: ["16:9", "1:1", "9:16"],
    type: ["text"],
    audio: false,
  },
  // kling-v1(PRO) 图生视频
  {
    manufacturer: "kling",
    model: "kling-v1(PRO)",
    durationResolutionMap: [{ duration: [5, 10], resolution: ["1080p"] }],
    aspectRatio: [],
    type: ["startEndRequired"],
    audio: false,
  },
  // kling-v1-6(PRO) 文生视频
  {
    manufacturer: "kling",
    model: "kling-v1-6(PRO)",
    durationResolutionMap: [{ duration: [5, 10], resolution: ["1080p"] }],
    aspectRatio: ["16:9", "1:1", "9:16"],
    type: ["text"],
    audio: false,
  },
  // kling-v1-6(PRO) 图生视频
  {
    manufacturer: "kling",
    model: "kling-v1-6(PRO)",
    durationResolutionMap: [{ duration: [5, 10], resolution: ["1080p"] }],
    aspectRatio: [],
    type: ["startEndRequired"],
    audio: false,
  },
  // kling-v2-5-turbo(PRO) 文生视频
  {
    manufacturer: "kling",
    model: "kling-v2-5-turbo(PRO)",
    durationResolutionMap: [{ duration: [5, 10], resolution: ["1080p"] }],
    aspectRatio: ["16:9", "1:1", "9:16"],
    type: ["text"],
    audio: false,
  },
  // kling-v2-5-turbo(PRO) 图生视频
  {
    manufacturer: "kling",
    model: "kling-v2-5-turbo(PRO)",
    durationResolutionMap: [{ duration: [5, 10], resolution: ["1080p"] }],
    aspectRatio: [],
    type: ["startEndRequired"],
    audio: false,
  },
  // kling-v2-6(PRO) 文生视频
  {
    manufacturer: "kling",
    model: "kling-v2-6(PRO)",
    durationResolutionMap: [{ duration: [5, 10], resolution: ["1080p"] }],
    aspectRatio: ["16:9", "1:1", "9:16"],
    type: ["text"],
    audio: false,
  },
  // kling-v2-6(PRO) 图生视频
  {
    manufacturer: "kling",
    model: "kling-v2-6(PRO)",
    durationResolutionMap: [{ duration: [5, 10], resolution: ["1080p"] }],
    aspectRatio: [],
    type: ["startEndRequired"],
    audio: false,
  },
  // ================== ViduQ3系列 ==================
  // viduq3-pro 文生视频
  {
    manufacturer: "vidu",
    model: "viduq3-pro",
    durationResolutionMap: [{ duration: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], resolution: ["540p", "720p", "1080p"] }],
    aspectRatio: ["16:9", "9:16", "3:4", "4:3", "1:1"],
    type: ["text"],
    audio: true,
  },
  // viduq3-pro 图生视频
  {
    manufacturer: "vidu",
    model: "viduq3-pro",
    durationResolutionMap: [{ duration: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], resolution: ["540p", "720p", "1080p"] }],
    aspectRatio: [],
    type: ["singleImage"],
    audio: true,
  },
  // viduq2-pro-fast 图生视频
  {
    manufacturer: "vidu",
    model: "viduq2-pro-fast",
    durationResolutionMap: [{ duration: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], resolution: ["720p", "1080p"] }],
    aspectRatio: [],
    type: ["singleImage", "startEndRequired"],
    audio: false,
  },
  // viduq2-pro 文生视频
  {
    manufacturer: "vidu",
    model: "viduq2-pro",
    durationResolutionMap: [{ duration: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], resolution: ["540p", "720p", "1080p"] }],
    aspectRatio: ["16:9", "9:16", "3:4", "4:3", "1:1"],
    type: ["text"],
    audio: false,
  },
  // viduq2-pro 图生视频
  {
    manufacturer: "vidu",
    model: "viduq2-pro",
    durationResolutionMap: [{ duration: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], resolution: ["540p", "720p", "1080p"] }],
    aspectRatio: [],
    type: ["singleImage", "reference", "startEndRequired"],
    audio: false,
  },
  // viduq2-turbo 文生视频
  {
    manufacturer: "vidu",
    model: "viduq2-turbo",
    durationResolutionMap: [{ duration: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], resolution: ["540p", "720p", "1080p"] }],
    aspectRatio: ["16:9", "9:16", "3:4", "4:3", "1:1"],
    type: ["text"],
    audio: false,
  },
  // viduq2-turbo 图生视频
  {
    manufacturer: "vidu",
    model: "viduq2-turbo",
    durationResolutionMap: [{ duration: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], resolution: ["540p", "720p", "1080p"] }],
    aspectRatio: [],
    type: ["singleImage", "reference", "startEndRequired"],
    audio: false,
  },
  // viduq1 文生视频
  {
    manufacturer: "vidu",
    model: "viduq1",
    durationResolutionMap: [{ duration: [5], resolution: ["1080p"] }],
    aspectRatio: ["16:9", "9:16", "1:1"],
    type: ["text"],
    audio: false,
  },
  // viduq1 图生视频
  {
    manufacturer: "vidu",
    model: "viduq1",
    durationResolutionMap: [{ duration: [5], resolution: ["1080p"] }],
    aspectRatio: [],
    type: ["singleImage", "reference", "startEndRequired"],
    audio: false,
  },
  // viduq1-classic 图生视频
  {
    manufacturer: "vidu",
    model: "viduq1-classic",
    durationResolutionMap: [{ duration: [5], resolution: ["1080p"] }],
    aspectRatio: [],
    type: ["singleImage", "startEndRequired"],
    audio: false,
  },
  // vidu2.0 图生视频
  {
    manufacturer: "vidu",
    model: "vidu2.0",
    durationResolutionMap: [
      { duration: [4], resolution: ["360p", "720p", "1080p"] },
      { duration: [8], resolution: ["720p"] },
    ],
    aspectRatio: [],
    type: ["singleImage", "reference", "startEndRequired"],
    audio: false,
  },
  // ================== sora系列 ==================
];

export default modelList;
