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

/**
 * A single Agent binding change. The `id` is the `o_agentDeploy` row identity
 * (the logical role is its `key` column); `modelName` is the `vendorId:modelId`
 * binding the caller wants to apply. An empty `modelName` clears the binding.
 */
export interface AgentBindingUpdate {
  readonly id: number;
  readonly name: string;
  readonly model: string;
  readonly modelName: string;
  readonly vendorId: string | null;
  readonly desc: string;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
}

/** Typed configuration-command seam, mirroring the database maintenance seam. */
export type ConfiguredVendorCommand =
  | { readonly kind: "validate" }
  | {
      readonly kind: "set-vendor-config";
      readonly vendorId: string;
      readonly inputValues: Record<string, unknown>;
      readonly customModels: readonly CustomVendorModelInput[];
    }
  | { readonly kind: "add"; readonly source: string }
  | { readonly kind: "program-update"; readonly vendorId: string; readonly source: string }
  | { readonly kind: "input-update"; readonly vendorId: string; readonly inputValues: Record<string, unknown> }
  | { readonly kind: "custom-model-update"; readonly vendorId: string; readonly model: CustomVendorModelInput }
  | { readonly kind: "custom-model-remove"; readonly vendorId: string; readonly modelName: string }
  | { readonly kind: "enable-disable"; readonly vendorId: string; readonly enable: boolean }
  | { readonly kind: "delete"; readonly vendorId: string }
  | { readonly kind: "agent-mode"; readonly mode: "0" | "1" }
  | { readonly kind: "agent-binding"; readonly bindings: readonly AgentBindingUpdate[] };

export type ConfiguredVendorCommandKind = ConfiguredVendorCommand["kind"];

export interface ValidateConfiguredVendorResult {
  readonly kind: "validate";
  readonly result: ConfiguredVendorValidationResult;
}

export interface SetVendorConfigResult {
  readonly kind: "set-vendor-config";
  readonly vendorId: string;
}

export interface AddVendorResult {
  readonly kind: "add";
  readonly vendorId: string;
}

export interface ProgramUpdateVendorResult {
  readonly kind: "program-update";
  readonly vendorId: string;
}

export interface InputUpdateVendorResult {
  readonly kind: "input-update";
  readonly vendorId: string;
}

export interface CustomModelUpdateResult {
  readonly kind: "custom-model-update";
  readonly vendorId: string;
}

export interface CustomModelRemoveResult {
  readonly kind: "custom-model-remove";
  readonly vendorId: string;
}

export interface EnableDisableVendorResult {
  readonly kind: "enable-disable";
  readonly vendorId: string;
}

export interface DeleteVendorResult {
  readonly kind: "delete";
  readonly vendorId: string;
}

export interface AgentModeResult {
  readonly kind: "agent-mode";
  readonly mode: "0" | "1";
}

export interface AgentBindingResult {
  readonly kind: "agent-binding";
  readonly count: number;
}

export type ConfiguredVendorResult =
  | ValidateConfiguredVendorResult
  | SetVendorConfigResult
  | AddVendorResult
  | ProgramUpdateVendorResult
  | InputUpdateVendorResult
  | CustomModelUpdateResult
  | CustomModelRemoveResult
  | EnableDisableVendorResult
  | DeleteVendorResult
  | AgentModeResult
  | AgentBindingResult;

export type ConfiguredVendorResultFor<TCommand extends ConfiguredVendorCommand> = TCommand extends {
  kind: "validate";
}
  ? ValidateConfiguredVendorResult
  : TCommand extends { kind: "set-vendor-config" }
    ? SetVendorConfigResult
    : TCommand extends { kind: "add" }
      ? AddVendorResult
      : TCommand extends { kind: "program-update" }
        ? ProgramUpdateVendorResult
        : TCommand extends { kind: "input-update" }
          ? InputUpdateVendorResult
          : TCommand extends { kind: "custom-model-update" }
            ? CustomModelUpdateResult
            : TCommand extends { kind: "custom-model-remove" }
              ? CustomModelRemoveResult
              : TCommand extends { kind: "enable-disable" }
                ? EnableDisableVendorResult
                : TCommand extends { kind: "delete" }
                  ? DeleteVendorResult
                  : TCommand extends { kind: "agent-mode" }
                    ? AgentModeResult
                    : TCommand extends { kind: "agent-binding" }
                      ? AgentBindingResult
                      : never;
