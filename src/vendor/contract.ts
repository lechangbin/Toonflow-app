import type { generateText, streamText } from "ai";

import type { ValidatedVideoGenerationCommand, VideoCapability, VideoModel } from "@/video/capability";

/**
 * Public configured-Vendor contract. Everything here is what a caller (HTTP
 * route, Agent tool, startup path) sees. It deliberately carries no database
 * row, JSON persistence, source path, VM export, or request name.
 */

export type VendorModelType = "text" | "image" | "video" | "tts";

export interface TextVendorModel {
  name: string;
  modelName: string;
  type: "text";
  think: boolean;
  [key: string]: unknown;
}

export interface ImageVendorModel {
  name: string;
  modelName: string;
  type: "image";
  [key: string]: unknown;
}

export interface TtsVendorModel {
  name: string;
  modelName: string;
  type: "tts";
  [key: string]: unknown;
}

/** A Model as the configured loader exposes it: already narrowed to its operation type. */
export type ConfiguredVendorModel = TextVendorModel | ImageVendorModel | VideoModel | TtsVendorModel;

/** A custom Model a caller configures. Permissive so it can be persisted and re-validated. */
export interface CustomVendorModelInput {
  modelName: string;
  name?: string;
  type?: VendorModelType;
  think?: boolean;
  [key: string]: unknown;
}

/**
 * The logical Text roles the application binds to a Model. Sub-roles refine a
 * role (`scriptAgent:decisionAgent`) and resolve to the parent role in simple
 * mode, matching the historical Agent deploy table.
 */
export type TextLogicalRole = "scriptAgent" | "productionAgent" | "universalAi";

export type TextLogicalKey = TextLogicalRole | `${"scriptAgent" | "productionAgent"}:${string}`;

export type TextModelTarget =
  | { readonly kind: "logical"; readonly key: TextLogicalKey }
  | { readonly kind: "direct"; readonly vendorId: string; readonly modelId: string };

export interface DirectModelTarget {
  readonly vendorId: string;
  readonly modelId: string;
}

/** Text invocation input: the AI SDK generation options minus the model. */
export type TextInvokeInput = Omit<Parameters<typeof generateText>[0], "model">;
export type TextStreamInput = Omit<Parameters<typeof streamText>[0], "model">;

export interface TextInvokeRequest {
  readonly target: TextModelTarget;
  readonly think?: boolean;
  readonly thinkLevel?: 0 | 1 | 2 | 3;
  readonly input: TextInvokeInput;
}

export interface TextStreamRequest {
  readonly target: TextModelTarget;
  readonly think?: boolean;
  readonly thinkLevel?: 0 | 1 | 2 | 3;
  readonly input: TextStreamInput;
}

export interface ImageReference {
  readonly type: "image";
  readonly base64: string;
}

export interface ImageGenerationInput {
  readonly prompt: string;
  readonly referenceList?: readonly ImageReference[];
  readonly size: "1K" | "2K" | "4K";
  readonly aspectRatio: `${number}:${number}`;
}

export interface ImageGenerationRequest {
  readonly target: DirectModelTarget;
  readonly input: ImageGenerationInput;
}

export interface AudioReference {
  readonly type: "audio";
  readonly base64: string;
}

export interface TtsGenerationInput {
  readonly text: string;
  readonly voice: string;
  readonly speechRate: number;
  readonly pitchRate: number;
  readonly volume: number;
  readonly referenceList?: readonly AudioReference[];
}

export interface TtsGenerationRequest {
  readonly target: DirectModelTarget;
  readonly input: TtsGenerationInput;
}

export type { VideoModel, VideoCapability, ValidatedVideoGenerationCommand };

export interface VideoGenerationRequest {
  readonly target: DirectModelTarget;
  readonly input: ValidatedVideoGenerationCommand;
}

export interface VendorInputDeclaration {
  readonly key: string;
  readonly label?: string;
  readonly type?: string;
  readonly required?: boolean;
  readonly placeholder?: string;
}

export interface TextModelSummary {
  readonly type: "text";
  readonly name: string;
  readonly modelName: string;
  readonly think: boolean;
}

export interface ImageModelSummary {
  readonly type: "image";
  readonly name: string;
  readonly modelName: string;
}

export interface VideoModelSummary {
  readonly type: "video";
  readonly name: string;
  readonly modelName: string;
  readonly capabilities: readonly VideoCapability[];
}

export interface TtsModelSummary {
  readonly type: "tts";
  readonly name: string;
  readonly modelName: string;
}

export type ModelSummary = TextModelSummary | ImageModelSummary | VideoModelSummary | TtsModelSummary;

export interface VendorSummary {
  readonly vendorId: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly modelTypes: readonly VendorModelType[];
}

export interface VendorInspection {
  readonly vendorId: string;
  readonly name: string;
  readonly description?: string;
  readonly version?: string;
  readonly author?: string;
  readonly inputs: readonly VendorInputDeclaration[];
  readonly models: readonly ModelSummary[];
}

export interface ConfiguredVendorValidationResult {
  readonly vendorIds: readonly string[];
  readonly modelCount: number;
  readonly textBindingCount: number;
}

/** Typed configuration-command seam, mirroring the database maintenance seam. */
export type ConfiguredVendorCommand =
  | { readonly kind: "validate" }
  | {
      readonly kind: "set-vendor-config";
      readonly vendorId: string;
      readonly inputValues: Record<string, unknown>;
      readonly customModels: readonly CustomVendorModelInput[];
    };

export type ConfiguredVendorCommandKind = ConfiguredVendorCommand["kind"];

export interface ValidateConfiguredVendorResult {
  readonly kind: "validate";
  readonly result: ConfiguredVendorValidationResult;
}

export interface SetVendorConfigResult {
  readonly kind: "set-vendor-config";
  readonly vendorId: string;
}

export type ConfiguredVendorResult = ValidateConfiguredVendorResult | SetVendorConfigResult;

export type ConfiguredVendorResultFor<TCommand extends ConfiguredVendorCommand> = TCommand extends {
  kind: "validate";
}
  ? ValidateConfiguredVendorResult
  : TCommand extends { kind: "set-vendor-config" }
    ? SetVendorConfigResult
    : never;
