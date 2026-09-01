/**
 * 预留的 Asset Reference 图像分析服务 seam（Issue #30）。
 *
 * 本版本人工描述必填，不实现自动分析。此模块只定义可调用的 seam 形状并
 * 提供一个始终报告"未实现"的保留实现：调用方可安全调用，但不会产生任何
 * 持久化副作用，descriptionSource 保持 manual、analysisState 保持
 * not_requested。后续接入 AI 分析时替换保留实现即可，领域契约不变。
 */

export interface AssetReferenceAnalysisInput {
  /** 参考图持久化媒体路径。 */
  readonly mediaPath: string;
  readonly mediaMime: string | null;
  /** 所属资产上下文，供未来分析对齐资产事实。 */
  readonly asset: {
    readonly projectId: number;
    readonly assetsId: number;
    readonly name: string | null;
    readonly type: string | null;
    readonly describe: string | null;
  };
}

/** 当前唯一合法结果：分析能力未实现。 */
export interface AssetReferenceAnalysisOutcome {
  readonly supported: false;
  readonly reason: "analysis-not-implemented";
}

export interface AssetReferenceAnalyzer {
  analyzeAssetReference(input: AssetReferenceAnalysisInput): Promise<AssetReferenceAnalysisOutcome>;
}

const reservedAnalyzer: AssetReferenceAnalyzer = {
  async analyzeAssetReference(): Promise<AssetReferenceAnalysisOutcome> {
    return { supported: false, reason: "analysis-not-implemented" };
  },
};

/** 可调用的 seam 入口：本版本始终返回未实现，且不产生持久化副作用。 */
export async function analyzeAssetReference(
  input: AssetReferenceAnalysisInput,
): Promise<AssetReferenceAnalysisOutcome> {
  return reservedAnalyzer.analyzeAssetReference(input);
}
