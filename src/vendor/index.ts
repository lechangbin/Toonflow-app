import { devToolsMiddleware } from "@ai-sdk/devtools";
import { extractReasoningMiddleware, generateText, stepCountIs, streamText, wrapLanguageModel } from "ai";

import { getDatabaseRuntime } from "@/database";
import getPath from "@/utils/getPath";
import { VideoPromptProfileRegistry } from "@/video/promptProfile";

import { createConfiguredVendorConfigRunner } from "./config";
import type {
  ConfiguredVendorCommand,
  ConfiguredVendorResultFor,
  ConfiguredVendorValidationResult,
  ImageGenerationRequest,
  TextInvokeRequest,
  TextStreamRequest,
  TtsGenerationRequest,
  VendorInspection,
  VendorSummary,
  VideoGenerationRequest,
} from "./contract";
import {
  loadConfiguredVendor,
  resolveTextTarget,
  summarizeModel,
  type ConfiguredVendorDependencies,
  type ResolvedTextModel,
} from "./loader";
import { deleteVendorSourceFile, readVendorSourceFile, validateConfiguredVendorsWith, writeVendorSourceFile } from "./startup";

/**
 * The public configured-Vendor interface. Every operation is typed and none of
 * them surface a database row, JSON persistence, source path, VM export, or
 * request name.
 */
export interface ConfiguredVendor {
  invokeText(request: TextInvokeRequest): ReturnType<typeof generateText>;
  streamText(request: TextStreamRequest): Promise<ReturnType<typeof streamText>>;
  generateImage(request: ImageGenerationRequest): Promise<string>;
  generateVideo(request: VideoGenerationRequest): Promise<string>;
  generateTts(request: TtsGenerationRequest): Promise<string>;
  listVendors(): Promise<VendorSummary[]>;
  inspectVendor(vendorId: string): Promise<VendorInspection>;
  validateStartup(): Promise<ConfiguredVendorValidationResult>;
  configure<TCommand extends ConfiguredVendorCommand>(command: TCommand): Promise<ConfiguredVendorResultFor<TCommand>>;
}

export function createConfiguredVendor(dependencies: ConfiguredVendorDependencies): ConfiguredVendor {
  const configRunner = createConfiguredVendorConfigRunner(dependencies);

  return {
    invokeText: (request) => invokeText(dependencies, request),
    streamText: (request) => streamTextOperation(dependencies, request),
    generateImage: (request) => generateImage(dependencies, request),
    generateVideo: (request) => generateVideo(dependencies, request),
    generateTts: (request) => generateTts(dependencies, request),
    listVendors: () => listVendors(dependencies),
    inspectVendor: (vendorId) => inspectVendor(dependencies, vendorId),
    validateStartup: () => validateConfiguredVendorsWith(dependencies),
    configure: (command) => configRunner.configure(command),
  };
}

export function createDefaultConfiguredVendor(): ConfiguredVendor {
  const dataRoot = getPath();
  return createConfiguredVendor({
    work: (operation) => getDatabaseRuntime().work(operation),
    readVendorSource: (vendorId) => readVendorSourceFile(vendorId, dataRoot),
    writeVendorSource: (vendorId, source) => writeVendorSourceFile(vendorId, source, dataRoot),
    deleteVendorSource: (vendorId) => deleteVendorSourceFile(vendorId, dataRoot),
    promptProfiles: VideoPromptProfileRegistry.load(getPath(["promptProfiles", "video"])),
  });
}

let defaultConfiguredVendor: ConfiguredVendor | undefined;

/**
 * The single process-wide configured-Vendor instance. Created lazily so route
 * modules can import it without touching the database or data root at import
 * time; its `work` closure resolves the runtime on every call.
 */
export function getDefaultConfiguredVendor(): ConfiguredVendor {
  if (!defaultConfiguredVendor) defaultConfiguredVendor = createDefaultConfiguredVendor();
  return defaultConfiguredVendor;
}

async function invokeText(dependencies: ConfiguredVendorDependencies, request: TextInvokeRequest) {
  const resolved = await resolveTextTarget(dependencies, request.target);
  const model = await resolveTextLanguageModel(dependencies, resolved, request.think, request.thinkLevel ?? 0, false);
  return generateText({
    ...(request.input.tools ? { stopWhen: stepCountIs(Object.keys(request.input.tools).length * 50) } : {}),
    ...request.input,
    model,
    ...(resolved.temperature ? { temperature: resolved.temperature } : {}),
    ...(resolved.maxOutputTokens ? { maxOutputTokens: resolved.maxOutputTokens } : {}),
  } as Parameters<typeof generateText>[0]);
}

async function streamTextOperation(dependencies: ConfiguredVendorDependencies, request: TextStreamRequest) {
  const resolved = await resolveTextTarget(dependencies, request.target);
  const model = await resolveTextLanguageModel(dependencies, resolved, request.think, request.thinkLevel ?? 0, true);
  return streamText({
    ...(request.input.tools ? { stopWhen: stepCountIs(Object.keys(request.input.tools).length * 50) } : {}),
    ...request.input,
    model,
    ...(resolved.temperature ? { temperature: resolved.temperature } : {}),
    ...(resolved.maxOutputTokens ? { maxOutputTokens: resolved.maxOutputTokens } : {}),
  } as Parameters<typeof streamText>[0]);
}

async function resolveTextLanguageModel(
  dependencies: ConfiguredVendorDependencies,
  resolved: ResolvedTextModel,
  think: boolean | undefined,
  thinkLevel: 0 | 1 | 2 | 3,
  includeReasoning: boolean,
) {
  const loaded = await loadConfiguredVendor(dependencies, resolved.vendorId);
  loaded.requireText(resolved.modelId);
  const baseModel = await loaded.bindText(resolved.modelId)(think, thinkLevel);

  const switchAiDevTool = await dependencies.work((db) => db("o_setting").where("key", "switchAiDevTool").first());
  const middleware: any[] = [];
  if (switchAiDevTool?.value === "1") middleware.push(devToolsMiddleware());
  if (includeReasoning) middleware.push(extractReasoningMiddleware({ tagName: "reasoning_content", separator: "\n" }));
  return middleware.length > 0
    ? wrapLanguageModel({ model: baseModel, middleware: middleware.length === 1 ? middleware[0] : middleware })
    : baseModel;
}

async function generateImage(dependencies: ConfiguredVendorDependencies, request: ImageGenerationRequest): Promise<string> {
  const loaded = await loadConfiguredVendor(dependencies, request.target.vendorId);
  loaded.requireImage(request.target.modelId);
  return loaded.bindImage(request.target.modelId)(request.input);
}

async function generateVideo(dependencies: ConfiguredVendorDependencies, request: VideoGenerationRequest): Promise<string> {
  const loaded = await loadConfiguredVendor(dependencies, request.target.vendorId);
  loaded.requireVideo(request.target.modelId);
  return loaded.bindVideo(request.target.modelId)(request.input);
}

async function generateTts(dependencies: ConfiguredVendorDependencies, request: TtsGenerationRequest): Promise<string> {
  const loaded = await loadConfiguredVendor(dependencies, request.target.vendorId);
  loaded.requireTts(request.target.modelId);
  return loaded.bindTts(request.target.modelId)(request.input);
}

async function listVendors(dependencies: ConfiguredVendorDependencies): Promise<VendorSummary[]> {
  const rows = await dependencies.work((db) => db("o_vendorConfig").select("id", "enable").orderBy("id", "asc"));
  const summaries: VendorSummary[] = [];
  for (const row of rows) {
    const loaded = await loadConfiguredVendor(dependencies, row.id);
    summaries.push({
      vendorId: loaded.vendorId,
      name: loaded.name,
      enabled: row.enable === 1,
      modelTypes: loaded.modelTypes,
    });
  }
  return summaries;
}

async function inspectVendor(dependencies: ConfiguredVendorDependencies, vendorId: string): Promise<VendorInspection> {
  const loaded = await loadConfiguredVendor(dependencies, vendorId);
  return {
    vendorId: loaded.vendorId,
    name: loaded.name,
    description: loaded.description,
    version: loaded.version,
    author: loaded.author,
    inputs: loaded.inputs,
    models: loaded.models.map(summarizeModel),
  };
}

export type { ConfiguredVendorDependencies, ConfiguredVendorConfig } from "./loader";
export * from "./contract";
export { validateConfiguredVendors } from "./startup";