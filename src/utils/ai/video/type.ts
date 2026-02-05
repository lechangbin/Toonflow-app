interface VideoConfig {
  duration: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
  resolution: "480p" | "720p" | "1080p";
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  savePath: string;
  imageBase64?: string[];
  audio?: boolean;
}

interface AIConfig {
  model?: string;
  apiKey?: string;
  baseURL?: string;
}
