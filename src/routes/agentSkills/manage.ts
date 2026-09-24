import express from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";

import { getDatabaseRuntime } from "@/database";
import { success } from "@/lib/responseFormat";
import { createSkillRuntime } from "@/skillRuntime";
import { skillManifestSchema } from "@/skillRuntime/manifest";

type SkillAdmin = Pick<ReturnType<typeof createSkillRuntime>,
  "listForAdministration" | "inspectRevisionForAdministration" | "createDefinition"
  | "validateDraft" | "saveDraft" | "updateDraft" | "publish" | "activate">;

const identifier = z.string().regex(/^[A-Za-z0-9._:@-]{1,128}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const draft = z.strictObject({ skillId: identifier,
  semanticVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  content: z.string().min(1).max(64_000), manifest: skillManifestSchema });
const command = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("list") }),
  z.strictObject({ action: z.literal("inspect"), revisionId: identifier }),
  z.strictObject({ action: z.literal("create"), name: z.string().min(1).max(80),
    description: z.string().min(1).max(500) }),
  draft.extend({ action: z.literal("validate") }),
  draft.extend({ action: z.literal("saveDraft") }),
  z.strictObject({ action: z.literal("updateDraft"), revisionId: identifier,
    expectedContentHash: hash, content: z.string().min(1).max(64_000),
    manifest: skillManifestSchema }),
  z.strictObject({ action: z.literal("publish"), revisionId: identifier,
    expectedContentHash: hash }),
  z.strictObject({ action: z.literal("activate"), skillId: identifier,
    revisionId: identifier, expectedBindingVersion: z.number().int().nonnegative() }),
]);

/** Application-wide Skill revisions are admin-only, not merely Project-owner-scoped. */
export function createSkillManagementRouter(dependencies: {
  runtime: SkillAdmin;
  isAdmin(actorUserId: number): Promise<boolean>;
}) {
  const router = express.Router();
  return router.post("/", async (req, res, next) => {
    const actor = Number((req as typeof req & { user?: { id?: unknown } }).user?.id);
    if (!Number.isSafeInteger(actor) || actor <= 0
      || !await dependencies.isAdmin(actor)) {
      res.status(403).send({ message: "Skill 管理仅限管理员" }); return;
    }
    const parsed = command.safeParse(req.body);
    if (!parsed.success) { res.status(400).send({ message: "Skill 管理命令无效" }); return; }
    try {
      const input = parsed.data;
      let result: unknown;
      switch (input.action) {
        case "list": result = await dependencies.runtime.listForAdministration(); break;
        case "inspect": result = await dependencies.runtime
          .inspectRevisionForAdministration(input.revisionId); break;
        case "create": result = await dependencies.runtime.createDefinition({
          name: input.name, description: input.description }); break;
        case "validate": result = dependencies.runtime.validateDraft(input); break;
        case "saveDraft": result = await dependencies.runtime.saveDraft(input); break;
        case "updateDraft": result = await dependencies.runtime.updateDraft(input); break;
        case "publish": result = await dependencies.runtime.publish(input); break;
        case "activate": result = await dependencies.runtime.activate(input); break;
      }
      res.set("Cache-Control", "no-store");
      res.status(200).send(success(result));
    } catch (error) {
      if (error instanceof TypeError || error instanceof z.ZodError
        || error instanceof Error && /content is empty|manifest identity differs/i.test(error.message)) {
        res.status(400).send({ message: "Skill 管理内容无效" }); return;
      }
      if (error instanceof Error && /is missing|not found/i.test(error.message)) {
        res.status(404).send({ message: "Skill 定义或修订不存在" }); return;
      }
      if (error instanceof Error && /conflict|changed|editable|already/i.test(error.message)) {
        res.status(409).send({ message: "Skill 状态或版本已变化，请刷新" }); return;
      }
      next(error);
    }
  });
}

export default createSkillManagementRouter({
  runtime: createSkillRuntime({ work: (operation) => getDatabaseRuntime().work(operation),
    now: () => Date.now(), createId: () => uuid() }),
  isAdmin: (actor) => getDatabaseRuntime().work(async (db) => Boolean(await db("o_user")
    .where({ id: actor, name: "admin" }).first("id"))),
});
