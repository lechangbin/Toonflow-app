import express from "express";
import { z } from "zod";

import {
  AGENT_RUN_START_SCHEMA_VERSION, AgentRunCommandConflictError,
  AgentRunConflictError, AgentRunContentRejectedError, AgentRunProjectNotFoundError,
  AgentRunStateConflictError, AgentRunVersionConflictError,
  PRODUCTION_HARNESS_ROLE, PRODUCTION_HARNESS_SCOPE,
  projectAgentRunToChatMessage, type AgentRuntime,
} from "@/agentRuntime";
import { ProductionHarnessOwnershipError, ProductionSkillSelectionError } from
  "@/agents/productionAgent/harnessPreparation";
import { createProductionHarnessEffects, ProductionHarnessEffectsConflictError,
  ProductionHarnessEffectsNotFoundError } from
  "@/agents/productionAgent/harnessEffects";
import { getDefaultProductionHarnessRuntime } from "@/agents/productionAgent/harnessRuntime";
import { createDefaultBillableImageRuntime } from "@/controlledTools/billableImageComposition";
import { getDatabaseRuntime } from "@/database";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

function actorUserId(req: express.Request): number | null {
  const id = Number((req as typeof req & { user?: { id?: unknown } }).user?.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Opt-in production guidance transport; legacy generation remains a separate path. */
type Effects = ReturnType<typeof createProductionHarnessEffects>;
const billableImage = createDefaultBillableImageRuntime();
export function createProductionHarnessRouter(runtime: AgentRuntime,
  effects: Effects = createProductionHarnessEffects({
    work: (operation) => getDatabaseRuntime().work(operation),
    inspectBillable: billableImage.approval.inspect,
  })) {
  const router = express.Router();
  router.post("/start", validateFields({
    schemaVersion: z.literal(AGENT_RUN_START_SCHEMA_VERSION),
    projectId: z.number().int().positive(), role: z.literal(PRODUCTION_HARNESS_ROLE),
    scope: z.literal(PRODUCTION_HARNESS_SCOPE),
    clientRequestId: z.string().trim().min(1).max(128),
    content: z.string().trim().min(1).max(20_000),
  }), async (req, res, next) => {
    const actor = actorUserId(req);
    if (!actor) { res.status(403).send({ message: "操作人身份无效" }); return; }
    try {
      const run = await runtime.start({ ...req.body, actorUserId: actor });
      res.status(200).send(success({ run, message: projectAgentRunToChatMessage(run) }));
    } catch (error) {
      if (error instanceof AgentRunContentRejectedError) {
        res.status(422).send({ message: error.message,
          violationCodes: error.violationCodes }); return;
      }
      if (error instanceof ProductionHarnessOwnershipError) {
        res.status(403).send({ message: error.message }); return;
      }
      if (error instanceof ProductionSkillSelectionError || error instanceof AgentRunConflictError) {
        res.status(409).send({ message: error.message }); return;
      }
      if (error instanceof AgentRunProjectNotFoundError) {
        res.status(404).send({ message: error.message }); return;
      }
      next(error);
    }
  });
  router.post("/inspect", validateFields({ projectId: z.number().int().positive(),
    runId: z.string().trim().min(1).max(128) }), async (req, res, next) => {
    const actor = actorUserId(req);
    if (!actor) { res.status(403).send({ message: "操作人身份无效" }); return; }
    try {
      const run = await runtime.inspect({ ...req.body, actorUserId: actor });
      if (!run || run.scope !== PRODUCTION_HARNESS_SCOPE) {
        res.status(404).send({ message: "Production Harness Run 不存在" }); return;
      }
      res.status(200).send(success({ run, message: projectAgentRunToChatMessage(run) }));
    } catch (error) { next(error); }
  });
  router.post("/list", validateFields({ projectId: z.number().int().positive(),
    role: z.literal(PRODUCTION_HARNESS_ROLE), scope: z.literal(PRODUCTION_HARNESS_SCOPE) }),
  async (req, res, next) => {
    const actor = actorUserId(req);
    if (!actor) { res.status(403).send({ message: "操作人身份无效" }); return; }
    try {
      const result = await runtime.list({ ...req.body, actorUserId: actor });
      res.status(200).send(success({ ...result,
        currentMessage: result.current ? projectAgentRunToChatMessage(result.current) : null,
        recentMessages: result.recent.map(projectAgentRunToChatMessage) }));
    } catch (error) { next(error); }
  });
  router.post("/effects", validateFields({ projectId: z.number().int().positive(),
    runId: z.string().trim().min(1).max(128) }), async (req, res, next) => {
    const actor = actorUserId(req);
    if (!actor) { res.status(403).send({ message: "操作人身份无效" }); return; }
    try {
      res.status(200).send(success(await effects({ ...req.body, actorUserId: actor })));
    } catch (error) {
      if (error instanceof ProductionHarnessEffectsNotFoundError) {
        res.status(404).send({ message: "Production Harness Run 不存在" }); return;
      }
      if (error instanceof ProductionHarnessEffectsConflictError) {
        res.status(409).send({ message: "Production Harness 效果证据不完整" }); return;
      }
      next(error);
    }
  });
  router.post("/cancel", validateFields({ projectId: z.number().int().positive(),
    runId: z.string().trim().min(1).max(128),
    clientCommandId: z.string().trim().min(1).max(128),
    expectedVersion: z.number().int().positive() }), async (req, res, next) => {
    const actor = actorUserId(req);
    if (!actor) { res.status(403).send({ message: "操作人身份无效" }); return; }
    try {
      const inspected = await runtime.inspect({ runId: req.body.runId,
        projectId: req.body.projectId, actorUserId: actor });
      if (!inspected || inspected.scope !== PRODUCTION_HARNESS_SCOPE) {
        res.status(404).send({ message: "Production Harness Run 不存在" }); return;
      }
      const run = await runtime.cancel({ ...req.body, actorUserId: actor });
      if (!run || run.scope !== PRODUCTION_HARNESS_SCOPE) {
        res.status(404).send({ message: "Production Harness Run 不存在" }); return;
      }
      res.status(200).send(success({ run, message: projectAgentRunToChatMessage(run) }));
    } catch (error) {
      if (error instanceof AgentRunCommandConflictError
        || error instanceof AgentRunVersionConflictError
        || error instanceof AgentRunStateConflictError) {
        res.status(409).send({ message: error.message }); return;
      }
      next(error);
    }
  });
  return router;
}

export default createProductionHarnessRouter(getDefaultProductionHarnessRuntime());
