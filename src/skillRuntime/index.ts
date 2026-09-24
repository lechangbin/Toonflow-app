import { createHash } from "node:crypto";

import type { DatabaseWork } from "@/database";
import { inspectPersistableText } from "@/diagnostics/traceSafeDiagnostics";

import { validateSkillManifest, type SkillManifest } from "./manifest";
import { resolveSkillDependenciesInTransaction } from "./resolution";
import { SKILL_ROUTING_SCHEMA_VERSION, routeSkillsInTransaction } from "./routing";

const IDENTIFIER = /^[A-Za-z0-9._:@-]{1,128}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function checkedAuthoring(content: string, manifest: unknown, skillId: string, semanticVersion: string) {
  if (typeof content !== "string" || content.trim().length === 0
    || Buffer.byteLength(content, "utf8") > 64_000 || !inspectPersistableText(content).ok) {
    throw new Error("Skill content is empty, oversized, or unsafe");
  }
  const parsed = validateSkillManifest(manifest, skillId, semanticVersion);
  const manifestJson = JSON.stringify(parsed);
  return { contentHash: hash(content), manifestJson, manifestHash: hash(manifestJson) };
}

/** Durable publication and binding boundary. Routing/permission resolution belongs to later T14/T15 slices. */
export function createSkillRuntime(dependencies: { work: DatabaseWork; now(): number; createId(): string }) {
  return {
    async listForAdministration() {
      return dependencies.work(async (db) => {
        const definitions = await db("o_agentSkillDefinition")
          .orderBy("createdAt", "desc").orderBy("id", "asc")
          .select("id", "name", "description", "createdAt");
        const bindings = await db("o_agentSkillBinding")
          .select("skillId", "activeRevisionId", "version", "updatedAt");
        const revisions = await db("o_agentSkillRevision")
          .orderBy("createdAt", "desc").orderBy("id", "asc")
          .select("id", "skillId", "semanticVersion", "status",
            "contentHash", "manifestHash", "createdAt", "publishedAt");
        return definitions.map((definition) => ({ ...definition,
          binding: bindings.find((entry) => entry.skillId === definition.id) ?? null,
          revisions: revisions.filter((entry) => entry.skillId === definition.id),
        }));
      });
    },
    async inspectRevisionForAdministration(revisionId: string) {
      if (!IDENTIFIER.test(revisionId)) throw new TypeError("Skill Revision identity is invalid");
      return dependencies.work(async (db) => {
        const revision = await db("o_agentSkillRevision")
          .where({ id: revisionId }).first();
        if (!revision) return null;
        if (hash(revision.content) !== revision.contentHash
          || hash(revision.manifestJson) !== revision.manifestHash) {
          throw new Error("Skill Revision evidence is corrupt");
        }
        const manifest = validateSkillManifest(JSON.parse(revision.manifestJson),
          revision.skillId, revision.semanticVersion);
        return { id: revision.id, skillId: revision.skillId,
          semanticVersion: revision.semanticVersion, status: revision.status,
          content: revision.content, manifest,
          contentHash: revision.contentHash, manifestHash: revision.manifestHash,
          createdAt: revision.createdAt, publishedAt: revision.publishedAt };
      });
    },
    validateDraft(input: { skillId: string; semanticVersion: string;
      content: string; manifest: SkillManifest }) {
      if (!IDENTIFIER.test(input.skillId) || !VERSION.test(input.semanticVersion)) {
        throw new TypeError("Skill draft identity is invalid");
      }
      const checked = checkedAuthoring(input.content, input.manifest,
        input.skillId, input.semanticVersion);
      return { skillId: input.skillId, semanticVersion: input.semanticVersion,
        contentHash: checked.contentHash, manifestHash: checked.manifestHash };
    },
    async createDefinition(input: { name: string; description: string }) {
      if (!/^[A-Za-z0-9._-]{1,80}$/.test(input.name) || !input.description.trim()
        || input.description.length > 500 || !inspectPersistableText(input.description).ok) {
        throw new TypeError("Skill Definition is invalid");
      }
      const id = dependencies.createId();
      const createdAt = dependencies.now();
      if (!IDENTIFIER.test(id) || !Number.isSafeInteger(createdAt) || createdAt < 0) {
        throw new TypeError("Skill Definition identity or time is invalid");
      }
      await dependencies.work((db) => db("o_agentSkillDefinition")
        .insert({ id, name: input.name, description: input.description, createdAt }));
      return { id, ...input, createdAt };
    },
    async saveDraft(input: { skillId: string; semanticVersion: string;
      content: string; manifest: SkillManifest }) {
      if (!IDENTIFIER.test(input.skillId) || !VERSION.test(input.semanticVersion)) {
        throw new TypeError("Skill draft identity is invalid");
      }
      const checked = checkedAuthoring(input.content, input.manifest, input.skillId, input.semanticVersion);
      const id = dependencies.createId();
      const createdAt = dependencies.now();
      if (!IDENTIFIER.test(id) || !Number.isSafeInteger(createdAt) || createdAt < 0) {
        throw new TypeError("Skill Revision identity or time is invalid");
      }
      await dependencies.work((db) => db.transaction(async (tx) => {
        if (!await tx("o_agentSkillDefinition").where({ id: input.skillId }).first("id")) {
          throw new Error("Skill Definition is missing");
        }
        await tx("o_agentSkillRevision").insert({ id, skillId: input.skillId,
          semanticVersion: input.semanticVersion, status: "draft", content: input.content,
          ...checked, createdAt });
      }));
      return { id, skillId: input.skillId, semanticVersion: input.semanticVersion,
        status: "draft" as const, contentHash: checked.contentHash,
        manifestHash: checked.manifestHash, createdAt };
    },
    async updateDraft(input: { revisionId: string; expectedContentHash: string;
      content: string; manifest: SkillManifest }) {
      if (!IDENTIFIER.test(input.revisionId) || !/^[a-f0-9]{64}$/.test(input.expectedContentHash)) {
        throw new TypeError("Skill draft update identity is invalid");
      }
      return dependencies.work((db) => db.transaction(async (tx) => {
        const draft = await tx("o_agentSkillRevision").where({ id: input.revisionId, status: "draft" }).first();
        if (!draft || draft.contentHash !== input.expectedContentHash) {
          throw new Error("Skill draft has changed or is no longer editable");
        }
        const checked = checkedAuthoring(input.content, input.manifest, draft.skillId, draft.semanticVersion);
        const changed = await tx("o_agentSkillRevision")
          .where({ id: draft.id, status: "draft", contentHash: input.expectedContentHash })
          .update({ content: input.content, ...checked });
        if (changed !== 1) throw new Error("Skill draft update conflicted");
        return { id: draft.id, status: "draft" as const, contentHash: checked.contentHash,
          manifestHash: checked.manifestHash };
      }));
    },
    async registerResource(input: { revisionId: string; resourceId: string;
      mediaType: "text/markdown" | "application/json"; content: string }) {
      if (![input.revisionId, input.resourceId].every((id) => IDENTIFIER.test(id))
        || !["text/markdown", "application/json"].includes(input.mediaType)
        || typeof input.content !== "string" || input.content.length === 0
        || Buffer.byteLength(input.content, "utf8") > 64_000
        || !inspectPersistableText(input.content).ok) {
        throw new TypeError("Skill ResourceRevision is invalid");
      }
      const createdAt = dependencies.now();
      if (!Number.isSafeInteger(createdAt) || createdAt < 0) throw new TypeError("Skill resource time is invalid");
      return dependencies.work((db) => db.transaction(async (tx) => {
        const draft = await tx("o_agentSkillRevision").where({ id: input.revisionId,
          status: "draft" }).first("manifestJson", "manifestHash", "semanticVersion", "skillId");
        if (!draft || hash(draft.manifestJson) !== draft.manifestHash) {
          throw new Error("Skill resource requires an intact draft Revision");
        }
        const manifest = validateSkillManifest(JSON.parse(draft.manifestJson),
          draft.skillId, draft.semanticVersion);
        const declared = manifest.resources.find((entry) => entry.id === input.resourceId);
        const contentHash = hash(input.content);
        if (!declared || declared.mediaType !== input.mediaType || declared.contentHash !== contentHash) {
          throw new Error("Skill resource differs from the declared immutable ID and hash");
        }
        const record = { skillRevisionId: input.revisionId, resourceId: input.resourceId,
          mediaType: input.mediaType, content: input.content, contentHash, createdAt };
        await tx("o_agentSkillResourceRevision").insert(record);
        return { resourceId: input.resourceId, contentHash, mediaType: input.mediaType };
      }));
    },
    async publish(input: { revisionId: string; expectedContentHash: string }) {
      if (!IDENTIFIER.test(input.revisionId) || !/^[a-f0-9]{64}$/.test(input.expectedContentHash)) {
        throw new TypeError("Skill publish identity is invalid");
      }
      const publishedAt = dependencies.now();
      if (!Number.isSafeInteger(publishedAt) || publishedAt < 0) throw new TypeError("Skill publish time is invalid");
      return dependencies.work((db) => db.transaction(async (tx) => {
        const draft = await tx("o_agentSkillRevision").where({ id: input.revisionId, status: "draft" }).first();
        if (!draft || draft.contentHash !== input.expectedContentHash) {
          throw new Error("Skill draft changed before publish");
        }
        const checked = checkedAuthoring(draft.content, JSON.parse(draft.manifestJson),
          draft.skillId, draft.semanticVersion);
        if (checked.contentHash !== draft.contentHash || checked.manifestHash !== draft.manifestHash) {
          throw new Error("Skill draft evidence is corrupt");
        }
        const manifest = validateSkillManifest(JSON.parse(draft.manifestJson),
          draft.skillId, draft.semanticVersion);
        const resources = await tx("o_agentSkillResourceRevision")
          .where({ skillRevisionId: draft.id });
        if (resources.length !== manifest.resources.length
          || resources.some((resource) => {
            const declared = manifest.resources.find((entry) => entry.id === resource.resourceId);
            return !declared || declared.mediaType !== resource.mediaType
              || declared.contentHash !== resource.contentHash
              || hash(resource.content) !== resource.contentHash;
          })) {
          throw new Error("Skill resource declarations are incomplete or corrupt");
        }
        const changed = await tx("o_agentSkillRevision")
          .where({ id: draft.id, status: "draft", contentHash: input.expectedContentHash })
          .update({ status: "published", publishedAt });
        if (changed !== 1) throw new Error("Skill publish conflicted");
        await tx("o_agentSkillRevisionPolicy").insert({ revisionId: draft.id,
          state: "active", version: 1, updatedAt: publishedAt });
        return { id: draft.id, skillId: draft.skillId, status: "published" as const,
          contentHash: draft.contentHash, manifestHash: draft.manifestHash, publishedAt };
      }));
    },
    async setRevisionLifecycle(input: { revisionId: string; expectedVersion: number;
      nextState: "deprecated" | "revoked" }) {
      if (!IDENTIFIER.test(input.revisionId) || !Number.isSafeInteger(input.expectedVersion)
        || input.expectedVersion <= 0 || !["deprecated", "revoked"].includes(input.nextState)) {
        throw new TypeError("Skill Revision lifecycle command is invalid");
      }
      const updatedAt = dependencies.now();
      if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) throw new TypeError("Skill lifecycle time is invalid");
      return dependencies.work((db) => db.transaction(async (tx) => {
        const policy = await tx("o_agentSkillRevisionPolicy").where({ revisionId: input.revisionId }).first();
        if (!policy || policy.version !== input.expectedVersion
          || policy.state === "revoked" || policy.state === input.nextState
          || (policy.state === "deprecated" && input.nextState !== "revoked")) {
          throw new Error("Skill Revision lifecycle transition conflicts");
        }
        const version = policy.version + 1;
        const changed = await tx("o_agentSkillRevisionPolicy")
          .where({ revisionId: input.revisionId, version: policy.version })
          .update({ state: input.nextState, version, updatedAt });
        if (changed !== 1) throw new Error("Skill Revision lifecycle transition conflicts");
        return { revisionId: input.revisionId, state: input.nextState, version, updatedAt };
      }));
    },
    async activate(input: { skillId: string; revisionId: string; expectedBindingVersion: number }) {
      if (![input.skillId, input.revisionId].every((id) => IDENTIFIER.test(id))
        || !Number.isSafeInteger(input.expectedBindingVersion) || input.expectedBindingVersion < 0) {
        throw new TypeError("Skill activation identity is invalid");
      }
      const updatedAt = dependencies.now();
      if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) throw new TypeError("Skill activation time is invalid");
      return dependencies.work((db) => db.transaction(async (tx) => {
        const revision = await tx("o_agentSkillRevision")
          .where({ id: input.revisionId, skillId: input.skillId, status: "published" }).first();
        if (!revision || hash(revision.content) !== revision.contentHash
          || hash(revision.manifestJson) !== revision.manifestHash) {
          throw new Error("Skill activation requires an intact published Revision");
        }
        validateSkillManifest(JSON.parse(revision.manifestJson), input.skillId, revision.semanticVersion);
        const policy = await tx("o_agentSkillRevisionPolicy").where({ revisionId: input.revisionId,
          state: "active" }).first("revisionId");
        if (!policy) throw new Error("Skill activation requires an active Revision policy");
        const existing = await tx("o_agentSkillBinding").where({ skillId: input.skillId }).first();
        if (Number(existing?.version ?? 0) !== input.expectedBindingVersion) {
          throw new Error("Skill Binding version conflict");
        }
        const version = input.expectedBindingVersion + 1;
        if (existing) {
          const changed = await tx("o_agentSkillBinding").where({ skillId: input.skillId, version: existing.version })
            .update({ activeRevisionId: input.revisionId, version, updatedAt });
          if (changed !== 1) throw new Error("Skill Binding version conflict");
        } else {
          await tx("o_agentSkillBinding").insert({ skillId: input.skillId,
            activeRevisionId: input.revisionId, version, updatedAt });
        }
        return { skillId: input.skillId, activeRevisionId: input.revisionId, version, updatedAt };
      }));
    },
    async bindRun(input: { runId: string; projectId: number; skillIds: readonly string[] }) {
      if (!IDENTIFIER.test(input.runId) || !Number.isSafeInteger(input.projectId) || input.projectId <= 0
        || input.skillIds.length > 30 || input.skillIds.some((id) => !IDENTIFIER.test(id))
        || new Set(input.skillIds).size !== input.skillIds.length) {
        throw new TypeError("Agent Run Skill binding request is invalid");
      }
      const boundAt = dependencies.now();
      if (!Number.isSafeInteger(boundAt) || boundAt < 0) throw new TypeError("Agent Run Skill binding time is invalid");
      return dependencies.work((db) => db.transaction(async (tx) => {
        const run = await tx("o_agentRun").where({ id: input.runId, projectId: input.projectId,
          status: "queued" }).first("id", "role");
        if (!run) throw new Error("Agent Run is not queued in Project scope");
        const alreadyBound = await tx("o_agentRunSkillBinding").where({ runId: input.runId }).select("skillId");
        if (alreadyBound.length > 0 && (alreadyBound.length !== input.skillIds.length
          || alreadyBound.some((entry) => !input.skillIds.includes(entry.skillId)))) {
          throw new Error("Agent Run Skill binding set was already frozen");
        }
        const frozen = [];
        for (const skillId of input.skillIds) {
          const existing = await tx("o_agentRunSkillBinding").where({ runId: input.runId, skillId }).first();
          if (existing) {
            const historical = await tx("o_agentSkillRevision")
              .where({ id: existing.revisionId, skillId, status: "published" }).first();
            if (!historical || hash(historical.content) !== existing.contentHash
              || hash(historical.manifestJson) !== existing.manifestHash
              || historical.contentHash !== existing.contentHash
              || historical.manifestHash !== existing.manifestHash) {
              throw new Error("Agent Run Skill binding evidence is corrupt");
            }
            const policy = await tx("o_agentSkillRevisionPolicy")
              .where({ revisionId: existing.revisionId }).first("state");
            if (!policy || policy.state === "revoked") {
              throw new Error("Agent Run Skill Revision was revoked");
            }
            frozen.push(existing);
            continue;
          }
          const active = await tx("o_agentSkillBinding as binding")
            .join("o_agentSkillRevision as revision", "revision.id", "binding.activeRevisionId")
            .where({ "binding.skillId": skillId, "revision.status": "published" })
            .first("revision.id as revisionId", "revision.semanticVersion", "revision.content",
              "revision.contentHash", "revision.manifestJson", "revision.manifestHash");
          if (!active || hash(active.content) !== active.contentHash
            || hash(active.manifestJson) !== active.manifestHash) {
            throw new Error("Agent Run cannot bind an unavailable Skill Revision");
          }
          const policy = await tx("o_agentSkillRevisionPolicy")
            .where({ revisionId: active.revisionId, state: "active" }).first("revisionId");
          if (!policy) throw new Error("Agent Run cannot bind a deprecated or revoked Skill Revision");
          const manifest = validateSkillManifest(JSON.parse(active.manifestJson), skillId,
            active.semanticVersion);
          if (!manifest.compatibleRoles.includes(run.role)) {
            throw new Error("Agent Run role is incompatible with Skill Revision");
          }
          const record = { runId: input.runId, skillId, revisionId: active.revisionId,
            contentHash: active.contentHash, manifestHash: active.manifestHash, boundAt };
          await tx("o_agentRunSkillBinding").insert(record);
          frozen.push(record);
        }
        return frozen;
      }));
    },
    async bindResolvedRun(input: { runId: string; projectId: number; rootSkillIds: readonly string[] }) {
      if (!IDENTIFIER.test(input.runId) || !Number.isSafeInteger(input.projectId)
        || input.projectId <= 0) {
        throw new TypeError("Agent Run resolved Skill binding identity is invalid");
      }
      const boundAt = dependencies.now();
      if (!Number.isSafeInteger(boundAt) || boundAt < 0) {
        throw new TypeError("Agent Run resolved Skill binding time is invalid");
      }
      return dependencies.work((db) => db.transaction(async (tx) => {
        const run = await tx("o_agentRun").where({ id: input.runId,
          projectId: input.projectId, status: "queued" }).first("id", "role");
        if (!run) throw new Error("Agent Run is not queued in Project scope");
        const prior = await tx("o_agentRunSkillBinding").where({ runId: input.runId }).first("skillId");
        if (prior) throw new Error("Agent Run Skill binding set was already frozen");
        const plan = await resolveSkillDependenciesInTransaction(tx,
          { role: run.role, rootSkillIds: input.rootSkillIds });
        for (const revision of plan.revisions) {
          await tx("o_agentRunSkillBinding").insert({ runId: input.runId,
            skillId: revision.skillId, revisionId: revision.revisionId,
            contentHash: revision.contentHash, manifestHash: revision.manifestHash, boundAt });
        }
        const planJson = JSON.stringify(plan);
        await tx("o_agentRunSkillResolution").insert({ runId: input.runId,
          schemaVersion: plan.schemaVersion, planJson, planHash: hash(planJson), boundAt });
        return plan;
      }));
    },
    async routeAndBindRun(input: { runId: string; projectId: number;
      intent: string; query: string }) {
      if (!IDENTIFIER.test(input.runId) || !Number.isSafeInteger(input.projectId)
        || input.projectId <= 0) throw new TypeError("Agent Run Skill routing identity is invalid");
      const routeId = dependencies.createId();
      const now = dependencies.now();
      if (!IDENTIFIER.test(routeId) || !Number.isSafeInteger(now) || now < 0) {
        throw new TypeError("Agent Run Skill routing evidence identity is invalid");
      }
      return dependencies.work((db) => db.transaction(async (tx) => {
        const run = await tx("o_agentRun").where({ id: input.runId,
          projectId: input.projectId, status: "queued" }).first("role");
        if (!run) throw new Error("Skill routing requires a queued Run in Project scope");
        if (await tx("o_agentRunSkillBinding").where({ runId: input.runId }).first("skillId")) {
          throw new Error("Agent Run Skill binding set was already frozen");
        }
        if (await tx("o_agentSkillRouteDecision").where({ runId: input.runId }).first("id")) {
          throw new Error("Agent Run Skill routing was already decided");
        }
        const decision = await routeSkillsInTransaction(tx,
          { role: run.role, intent: input.intent, query: input.query });
        const decisionJson = JSON.stringify(decision);
        await tx("o_agentSkillRouteDecision").insert({ id: routeId, runId: input.runId,
          projectId: input.projectId, schemaVersion: SKILL_ROUTING_SCHEMA_VERSION,
          intent: input.intent, queryHash: hash(input.query), decisionJson,
          decisionHash: hash(decisionJson), createdAt: now });
        if (!decision.selected) return { routeId, decision, plan: null };
        const plan = await resolveSkillDependenciesInTransaction(tx,
          { role: run.role, rootSkillIds: [decision.selected.skillId] });
        const root = plan.revisions.find((entry) => entry.skillId === decision.selected!.skillId);
        if (!root || root.revisionId !== decision.selected.revisionId) {
          throw new Error("Skill routing and dependency root Revision diverged");
        }
        for (const revision of plan.revisions) {
          await tx("o_agentRunSkillBinding").insert({ runId: input.runId,
            skillId: revision.skillId, revisionId: revision.revisionId,
            contentHash: revision.contentHash, manifestHash: revision.manifestHash, boundAt: now });
        }
        const planJson = JSON.stringify(plan);
        await tx("o_agentRunSkillResolution").insert({ runId: input.runId,
          schemaVersion: plan.schemaVersion, planJson, planHash: hash(planJson), boundAt: now });
        return { routeId, decision, plan };
      }));
    },
    async loadResource(input: { runId: string; projectId: number;
      skillId: string; resourceId: string }) {
      if (!Number.isSafeInteger(input.projectId) || input.projectId <= 0
        || ![input.runId, input.skillId, input.resourceId].every((id) => IDENTIFIER.test(id))) {
        throw new TypeError("Skill resource request is invalid");
      }
      const accessId = dependencies.createId();
      const accessedAt = dependencies.now();
      if (!IDENTIFIER.test(accessId) || !Number.isSafeInteger(accessedAt) || accessedAt < 0) {
        throw new TypeError("Skill resource access evidence identity is invalid");
      }
      return dependencies.work((db) => db.transaction(async (tx) => {
        const run = await tx("o_agentRun").where({ id: input.runId,
          projectId: input.projectId }).first("id");
        const binding = await tx("o_agentRunSkillBinding").where({ runId: input.runId,
          skillId: input.skillId }).first();
        if (!run || !binding) throw new Error("Skill resource is outside authorized Run binding");
        const revision = await tx("o_agentSkillRevision").where({ id: binding.revisionId,
          skillId: input.skillId, status: "published" }).first();
        if (!revision || hash(revision.content) !== binding.contentHash
          || hash(revision.manifestJson) !== binding.manifestHash
          || revision.contentHash !== binding.contentHash
          || revision.manifestHash !== binding.manifestHash) {
          throw new Error("Skill resource binding evidence is corrupt");
        }
        const policy = await tx("o_agentSkillRevisionPolicy")
          .where({ revisionId: revision.id }).first("state");
        if (!policy || policy.state === "revoked") throw new Error("Skill resource Revision was revoked");
        const manifest = validateSkillManifest(JSON.parse(revision.manifestJson),
          input.skillId, revision.semanticVersion);
        const declared = manifest.resources.find((entry) => entry.id === input.resourceId);
        const resource = await tx("o_agentSkillResourceRevision").where({
          skillRevisionId: revision.id, resourceId: input.resourceId }).first();
        if (!declared || !resource || declared.contentHash !== resource.contentHash
          || declared.mediaType !== resource.mediaType || hash(resource.content) !== resource.contentHash
          || !inspectPersistableText(resource.content).ok) {
          throw new Error("Skill resource ID or revision is unavailable");
        }
        await tx("o_agentSkillResourceAccess").insert({ id: accessId, runId: input.runId,
          skillId: input.skillId, skillRevisionId: revision.id,
          resourceId: input.resourceId, contentHash: resource.contentHash, createdAt: accessedAt });
        return { resourceId: input.resourceId, mediaType: resource.mediaType,
          content: resource.content, contentHash: resource.contentHash,
          skillRevisionId: revision.id, accessId };
      }));
    },
  };
}
