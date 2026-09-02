import assert from "node:assert/strict";
import test from "node:test";

import { getDatabaseRuntime, openDatabase } from "../src/database";
import useProductionAgentTools from "../src/agents/productionAgent/tools";
import type { DerivedChangeInstruction } from "../src/assets/derivedChangeInstruction";
import { withDataRoot } from "./databaseTestSupport";

const LEGACY_PROP_INSTRUCTION = {
  changeKind: "legacy_prop_state" as const,
  evidence: ["第三幕：名册被暴雨浸湿。"],
  preserve: ["几何轮廓", "材料工艺", "辨识标记"],
  change: ["纸页被雨水浸湿并出现水渍"],
  exclude: ["人物", "手部", "文字"],
};

interface AddDerivedAssetInput {
  assetsId: number;
  id: number | null;
  name: string;
  desc: string;
  changeInstruction: DerivedChangeInstruction;
}

function createAddDerivedAssetTool(projectId: number) {
  const socketEvents: string[] = [];
  const thinking = {
    appendText: () => thinking,
    updateTitle: () => thinking,
    complete: () => thinking,
  };
  const resTool = {
    data: { projectId, scriptId: 10 },
    socket: {
      emit(event: string, ...args: unknown[]) {
        socketEvents.push(event);
        const callback = args.at(-1);
        if (typeof callback === "function") callback("socket mutation accepted");
      },
    },
  };
  const tools = useProductionAgentTools({
    resTool,
    msg: { thinking: () => thinking },
    toolsNames: ["add_deriveAsset"],
  } as never);
  const addDerivedAsset = tools.add_deriveAsset as unknown as {
    execute: (input: AddDerivedAssetInput) => Promise<unknown>;
  };
  return { execute: addDerivedAsset.execute, socketEvents };
}

async function seedPropAssets(): Promise<void> {
  await getDatabaseRuntime().work(async (db) => {
    await db("o_project").insert([
      { id: 1, name: "项目一", artStyle: "guofeng_3d" },
      { id: 2, name: "项目二", artStyle: "guofeng_3d" },
    ]);
    await db("o_assets").insert([
      { id: 101, projectId: 1, name: "名册", type: "tool", describe: "秦宫名册" },
      { id: 102, projectId: 1, name: "玉玺", type: "tool", describe: "秦宫玉玺" },
      { id: 111, projectId: 1, assetsId: 101, name: "浸湿名册", type: "tool", describe: "被暴雨浸湿" },
      { id: 112, projectId: 1, assetsId: 102, name: "破损玉玺", type: "tool", describe: "边角破损" },
      { id: 211, projectId: 2, assetsId: 101, name: "外部项目名册", type: "tool", describe: "不属于项目一" },
      { id: 301, projectId: 1, name: "将军", type: "role", describe: "父角色" },
      { id: 302, projectId: 1, name: "谋士", type: "role", describe: "另一父角色" },
      { id: 311, projectId: 1, assetsId: 301, name: "披甲将军", type: "role", describe: "换甲" },
      { id: 312, projectId: 1, assetsId: 302, name: "披甲谋士", type: "role", describe: "换甲" },
      { id: 411, projectId: 2, assetsId: 301, name: "外部项目将军", type: "role", describe: "不属于项目一" },
    ]);
  });
}

const ROLE_INSTRUCTION: DerivedChangeInstruction = {
  changeKind: "character_wardrobe",
  evidence: ["第三幕：将军换上战甲。"],
  preserve: ["人物身份", "面部特征", "体型"],
  change: ["换上战甲"],
  exclude: ["身份改变"],
};

function roleUpdate(id: number): AddDerivedAssetInput {
  return {
    assetsId: 301,
    id,
    name: "披甲将军",
    desc: "换上战甲",
    changeInstruction: ROLE_INSTRUCTION,
  };
}

function propUpdate(id: number): AddDerivedAssetInput {
  return {
    assetsId: 101,
    id,
    name: "浸湿名册",
    desc: "纸页被暴雨浸湿",
    changeInstruction: LEGACY_PROP_INSTRUCTION,
  };
}

test("Production Agent 拒绝用伪造的非空 ID 新建 Derived Prop", async () => {
  await withDataRoot("toonflow-derived-tool-guard-", async (dataRoot) => {
    await openDatabase({ dataRoot });
    await seedPropAssets();
    const harness = createAddDerivedAssetTool(1);

    const result = await harness.execute(propUpdate(999));

    assert.match(String(result), /仅可更新.*既有衍生道具/);
    assert.deepEqual(harness.socketEvents, [], "拒绝发生在任何前端资产 mutation 之前");
  });
});

test("Production Agent 只更新当前项目且挂在指定父 Asset 下的既有 Derived Prop", async () => {
  await withDataRoot("toonflow-derived-tool-owner-", async (dataRoot) => {
    await openDatabase({ dataRoot });
    await seedPropAssets();
    const harness = createAddDerivedAssetTool(1);

    const foreignProject = await harness.execute(propUpdate(211));
    assert.match(String(foreignProject), /仅可更新.*既有衍生道具/);

    const wrongParent = await harness.execute(propUpdate(112));
    assert.match(String(wrongParent), /仅可更新.*既有衍生道具/);
    assert.deepEqual(harness.socketEvents, [], "越权或错父级目标不得触发前端资产 mutation");

    const accepted = await harness.execute(propUpdate(111));
    assert.equal(accepted, "socket mutation accepted");
    assert.deepEqual(harness.socketEvents, ["addDeriveAsset"]);
  });
});

test("Production Agent 对角色更新同样拒绝伪造、基础、错父与跨项目目标", async () => {
  await withDataRoot("toonflow-derived-role-owner-", async (dataRoot) => {
    await openDatabase({ dataRoot });
    await seedPropAssets();
    const harness = createAddDerivedAssetTool(1);

    for (const id of [999, 301, 312, 411]) {
      const rejected = await harness.execute(roleUpdate(id));
      assert.match(String(rejected), /仅可更新.*既有衍生资产/);
    }
    assert.deepEqual(harness.socketEvents, [], "非法角色更新不得触发前端 mutation");

    const accepted = await harness.execute(roleUpdate(311));
    assert.equal(accepted, "socket mutation accepted");
    assert.deepEqual(harness.socketEvents, ["addDeriveAsset"]);
  });
});
