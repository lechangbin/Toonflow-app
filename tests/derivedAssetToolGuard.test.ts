import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { getDatabaseRuntime, openDatabase } from "../src/database";
import useProductionAgentTools from "../src/agents/productionAgent/tools";
import { VISUAL_STATE_DIMENSIONS, type DerivedChangeInstruction } from "../src/assets/derivedChangeInstruction";
import { withDataRoot } from "./databaseTestSupport";

const PROP_CONDITION_INSTRUCTION: DerivedChangeInstruction = {
  dimensions: ["condition"],
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

function createDeleteDerivedAssetTool(projectId: number) {
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
    toolsNames: ["del_deriveAsset"],
  } as never);
  const deleteDerivedAsset = tools.del_deriveAsset as unknown as {
    execute: (input: { assetsId: number; id: number }) => Promise<unknown>;
  };
  return { execute: deleteDerivedAsset.execute, socketEvents };
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
  dimensions: ["wardrobe"],
  evidence: ["第三幕：将军换上战甲。"],
  preserve: ["人物身份", "面部特征", "体型"],
  change: ["换上战甲"],
  exclude: ["身份改变"],
};

function roleUpdate(id: number | null): AddDerivedAssetInput {
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
    changeInstruction: PROP_CONDITION_INSTRUCTION,
  };
}

test("Derived Asset Skill 只指导 Agent 提交工具实际接受的字段", () => {
  const skill = fs.readFileSync(path.resolve("data/skills/production_execution_derive_assets.md"), "utf8");
  const callContract = skill.match(/add_deriveAsset\(\{([\s\S]*?)\n\}\)/u)?.[1] ?? "";

  assert.ok(callContract, "Skill 必须包含 add_deriveAsset 调用契约");
  assert.doesNotMatch(callContract, /^\s*type\s*:/mu, "资产类型由父 Asset 决定，不得指导 Agent 发送 Schema 未接受的 type");
  assert.match(skill, /类型由父 Asset 自动继承/u);
  assert.match(callContract, /dimensions:/u, "调用契约必须使用新版 dimensions[]");
  assert.doesNotMatch(callContract, /changeKind/u, "调用契约不得再指导发送旧版 changeKind");
});

test("Derived Asset Skill 允许零个衍生且无固定数量上下限", () => {
  const skill = fs.readFileSync(path.resolve("data/skills/production_execution_derive_assets.md"), "utf8");
  assert.doesNotMatch(skill, /1~5|1～5|至少\s*1\s*个衍生|最少.*个衍生/u, "不得保留强制每个资产 1~5 个衍生的规则");
  assert.match(skill, /0~N/u, "必须声明每个父资产允许 0~N 个衍生资产");
  assert.match(skill, /零个|无需衍生/u, "没有合格状态变化时必须允许返回零个衍生资产");
  assert.match(skill, /camera|shot_scale|expression/u, "必须列明镜头/构图/动作/表情等禁止维度");
  assert.match(skill, /weather.*time_of_day|time_of_day.*weather/us, "必须说明复合状态（如雨夜）用多维度单一衍生表达");
  assert.doesNotMatch(skill, /道具一律不衍生|道具不提取任何变体|道具.*不提取任何变体/u, "道具衍生解禁后不得保留旧的禁止规则");
});

test("Skill 与架构文档的维度表与代码枚举保持同步", () => {
  const skill = fs.readFileSync(path.resolve("data/skills/production_execution_derive_assets.md"), "utf8");
  const doc = fs.readFileSync(path.resolve("docs/agents/asset-prompt-generation.md"), "utf8");
  for (const dimension of VISUAL_STATE_DIMENSIONS) {
    assert.ok(skill.includes(`\`${dimension}\``), `Skill 维度表缺少 ${dimension}`);
    assert.ok(doc.includes(`\`${dimension}\``), `架构文档缺少维度 ${dimension}`);
  }
  for (const prohibited of ["camera", "shot_scale", "framing", "frame_position", "pose", "action_phase", "expression", "gaze", "eyeline"]) {
    assert.ok(skill.includes(prohibited), `Skill 必须列明禁止维度 ${prohibited}`);
  }
});

test("Production Agent 拒绝用伪造的非空 ID 新建 Derived Prop", async () => {
  await withDataRoot("toonflow-derived-tool-guard-", async (dataRoot) => {
    await openDatabase({ dataRoot });
    await seedPropAssets();
    const harness = createAddDerivedAssetTool(1);

    const result = await harness.execute(propUpdate(999));

    assert.match(String(result), /仅可更新.*既有衍生资产/);
    assert.deepEqual(harness.socketEvents, [], "拒绝发生在任何前端资产 mutation 之前");
  });
});

test("Production Agent 只更新当前项目且挂在指定父 Asset 下的既有 Derived Prop", async () => {
  await withDataRoot("toonflow-derived-tool-owner-", async (dataRoot) => {
    await openDatabase({ dataRoot });
    await seedPropAssets();
    const harness = createAddDerivedAssetTool(1);

    const foreignProject = await harness.execute(propUpdate(211));
    assert.match(String(foreignProject), /仅可更新.*既有衍生资产/);

    const wrongParent = await harness.execute(propUpdate(112));
    assert.match(String(wrongParent), /仅可更新.*既有衍生资产/);
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

test("Production Agent 删除只允许当前项目指定父资产下的 Derived Asset", async () => {
  await withDataRoot("toonflow-derived-delete-owner-", async (dataRoot) => {
    await openDatabase({ dataRoot });
    await seedPropAssets();
    const harness = createDeleteDerivedAssetTool(1);

    for (const target of [
      { assetsId: 301, id: 411 },
      { assetsId: 301, id: 312 },
      { assetsId: 301, id: 301 },
    ]) {
      const rejected = await harness.execute(target);
      assert.match(String(rejected), /衍生资产不存在|不属于当前项目|父资产不匹配/);
    }
    assert.deepEqual(harness.socketEvents, [], "非法删除不得触发前端 mutation");
    assert.equal((await getDatabaseRuntime().work((db) => db("o_assets").whereIn("id", [301, 312, 411]).select())).length, 3);

    const accepted = await harness.execute({ assetsId: 301, id: 311 });
    assert.equal(accepted, "socket mutation accepted");
    assert.equal(await getDatabaseRuntime().work((db) => db("o_assets").where("id", 311).first()), undefined);
    assert.deepEqual(harness.socketEvents, ["delDeriveAsset"]);
  });
});

test("Production Agent 可为道具父资产新增衍生（浸湿/损坏/配置/激活）", async () => {
  await withDataRoot("toonflow-derived-prop-create-", async (dataRoot) => {
    await openDatabase({ dataRoot });
    await seedPropAssets();
    const harness = createAddDerivedAssetTool(1);

    const created = await harness.execute({
      assetsId: 102,
      id: null,
      name: "展开玉匣",
      desc: "匣盖开启 · 内衬露出",
      changeInstruction: {
        dimensions: ["configuration", "contents"],
        evidence: ["第一幕：使者打开玉匣，匣内衬垫完整。"],
        preserve: ["几何轮廓", "材料工艺", "辨识标记"],
        change: ["匣盖由闭合变为开启，露出内衬与内容物"],
        exclude: ["人物", "手部"],
      },
    });
    assert.equal(created, "socket mutation accepted");
    assert.deepEqual(harness.socketEvents, ["addDeriveAsset"]);

    const row = await getDatabaseRuntime().work((db) =>
      db("o_assets").where({ assetsId: 102, projectId: 1, name: "展开玉匣" }).first(),
    );
    assert.ok(row, "新增衍生道具必须落库");
    const instruction = await getDatabaseRuntime().work((db) =>
      db("o_derivedChangeInstruction").where({ assetsId: row.id, projectId: 1 }).first(),
    );
    assert.ok(instruction, "新增衍生道具必须同时写入变化契约");
    assert.deepEqual(JSON.parse(instruction.instruction).dimensions, ["configuration", "contents"]);
  });
});

test("一个父资产允许新增多个不同维度组合的衍生资产", async () => {
  await withDataRoot("toonflow-derived-multi-siblings-", async (dataRoot) => {
    await openDatabase({ dataRoot });
    await seedPropAssets();
    const harness = createAddDerivedAssetTool(1);

    const siblings: AddDerivedAssetInput[] = [
      {
        assetsId: 301,
        id: null,
        name: "少年将军",
        desc: "年龄阶段前移 · 少年体态",
        changeInstruction: {
          dimensions: ["age_stage"],
          evidence: ["序幕：将军年少从军，尚未蓄须。"],
          preserve: ["人物身份", "面部特征"],
          change: ["年龄阶段回退为少年体态"],
          exclude: ["身份改变"],
        },
      },
      {
        assetsId: 301,
        id: null,
        name: "甲胄将军",
        desc: "换上玄甲 · 战损披风",
        changeInstruction: {
          dimensions: ["wardrobe", "surface_condition"],
          evidence: ["第三幕：将军披甲出征，甲上添战损。"],
          preserve: ["人物身份", "面部特征", "体型"],
          change: ["换上玄色甲胄，披风出现战损"],
          exclude: ["身份改变"],
        },
      },
      {
        assetsId: 301,
        id: null,
        name: "拜将将军",
        desc: "身份地位呈现 · 仪仗装束",
        changeInstruction: {
          dimensions: ["status_presentation"],
          evidence: ["第五幕：将军受拜将礼，着仪仗朝服。"],
          preserve: ["人物身份", "面部特征", "体型"],
          change: ["着拜将仪仗朝服并佩印绶"],
          exclude: ["身份改变"],
        },
      },
    ];

    for (const sibling of siblings) {
      assert.equal(await harness.execute(sibling), "socket mutation accepted");
    }
    assert.deepEqual(harness.socketEvents, ["addDeriveAsset", "addDeriveAsset", "addDeriveAsset"]);
    const count = await getDatabaseRuntime().work((db) =>
      db("o_assets").where({ assetsId: 301, projectId: 1 }).count("id as total").first(),
    );
    assert.equal(Number(count?.total ?? 0), 4, "已有 1 条 + 新增 3 条不同维度组合的衍生资产");
  });
});

test("等价的父资产与状态组合不会重复写入，必须复用既有衍生资产", async () => {
  await withDataRoot("toonflow-derived-duplicate-reuse-", async (dataRoot) => {
    await openDatabase({ dataRoot });
    await seedPropAssets();
    const harness = createAddDerivedAssetTool(1);

    // 先为道具父资产 101 新增浸湿衍生
    const soakedChange = ["纸页被雨水浸湿并出现水渍"];
    const first = await harness.execute({
      assetsId: 101,
      id: null,
      name: "雨夜名册",
      desc: "纸页浸湿 · 墨迹晕染",
      changeInstruction: {
        dimensions: ["condition"],
        evidence: ["第三幕：名册被暴雨浸湿。"],
        preserve: ["几何轮廓", "材料工艺", "辨识标记"],
        change: soakedChange,
        exclude: ["人物", "手部"],
      },
    });
    assert.equal(first, "socket mutation accepted");

    // 相同父资产 + 等价状态组合（dimensions 与 change 都一致，顺序无关）：拒绝并提示复用
    const duplicate = await harness.execute({
      assetsId: 101,
      id: null,
      name: "浸湿名册",
      desc: "重复状态",
      changeInstruction: {
        dimensions: ["condition"],
        evidence: ["第三幕：名册再度被雨水打湿。"],
        preserve: ["几何轮廓", "材料工艺", "辨识标记"],
        change: ["纸页被雨水浸湿并出现水渍"],
        exclude: ["人物"],
      },
    });
    assert.match(String(duplicate), /已存在等价.*衍生资产|复用/u);
    assert.equal(harness.socketEvents.length, 1, "等价状态不得重复触发资产写入");

    // 同一维度下的不同状态值（浸湿 vs 焚毁）是不同状态：允许各自建立
    const burnt = await harness.execute({
      assetsId: 101,
      id: null,
      name: "焚毁名册",
      desc: "边角焚毁 · 余烬",
      changeInstruction: {
        dimensions: ["condition"],
        evidence: ["第四幕：名册被火点燃。"],
        preserve: ["几何轮廓", "材料工艺", "辨识标记"],
        change: ["边角被焚毁并带余烬"],
        exclude: ["人物"],
      },
    });
    assert.equal(burnt, "socket mutation accepted", "同一维度不同状态值不得被误判为重复");
    assert.equal(harness.socketEvents.length, 2);

    // 不同维度组合同样不受影响
    const other = await harness.execute({
      assetsId: 101,
      id: null,
      name: "开启玉匣",
      desc: "匣盖开启",
      changeInstruction: {
        dimensions: ["configuration", "contents"],
        evidence: ["第一幕：使者打开玉匣。"],
        preserve: ["几何轮廓", "材料工艺", "辨识标记"],
        change: ["匣盖由闭合变为开启，露出内衬与内容物"],
        exclude: ["人物"],
      },
    });
    assert.equal(other, "socket mutation accepted");
    assert.equal(harness.socketEvents.length, 3);
  });
});

test("并发新增同一等价状态时只能持久化一个 Derived Asset", async () => {
  await withDataRoot("toonflow-derived-concurrent-equivalent-", async (dataRoot) => {
    await openDatabase({ dataRoot });
    await seedPropAssets();
    const firstHarness = createAddDerivedAssetTool(1);
    const secondHarness = createAddDerivedAssetTool(1);
    const input: AddDerivedAssetInput = {
      assetsId: 102,
      id: null,
      name: "雨夜开启玉匣",
      desc: "匣盖开启并被雨水浸湿",
      changeInstruction: {
        dimensions: ["configuration", "condition"],
        evidence: ["第三幕：雨夜中使者打开被雨水浸湿的玉匣。"],
        preserve: ["几何轮廓", "材料工艺", "辨识标记"],
        change: ["匣盖开启", "表面被雨水浸湿"],
        exclude: ["人物", "手部"],
      },
    };

    const results = await Promise.all([firstHarness.execute(input), secondHarness.execute(input)]);

    assert.equal(results.filter((result) => result === "socket mutation accepted").length, 1);
    assert.equal(results.filter((result) => /已存在等价.*衍生资产|复用/u.test(String(result))).length, 1);
    const rows = await getDatabaseRuntime().work((db) =>
      db("o_assets").where({ assetsId: 102, projectId: 1, name: "雨夜开启玉匣" }).select("id"),
    );
    assert.equal(rows.length, 1, "并发请求不得创建两个等价兄弟资产");
    assert.equal(firstHarness.socketEvents.length + secondHarness.socketEvents.length, 1);
  });
});

test("更新衍生资产不得改写为与其他兄弟等价的状态组合", async () => {
  await withDataRoot("toonflow-derived-update-collision-", async (dataRoot) => {
    await openDatabase({ dataRoot });
    await seedPropAssets();
    const harness = createAddDerivedAssetTool(1);

    // 既有衍生道具 111（浸湿名册，挂在父资产 101 下）先写入契约
    const accepted = await harness.execute(propUpdate(111));
    assert.equal(accepted, "socket mutation accepted");

    // 把 112（父资产 102 下）之外的另一条 101 子资产改写为与 111 等价：先为 101 新增第二条
    const added = await harness.execute({
      assetsId: 101,
      id: null,
      name: "焚毁名册",
      desc: "边角焚毁",
      changeInstruction: {
        dimensions: ["condition"],
        evidence: ["第四幕：名册被火点燃。"],
        preserve: ["几何轮廓", "材料工艺", "辨识标记"],
        change: ["边角被焚毁并带余烬"],
        exclude: ["人物"],
      },
    });
    assert.equal(added, "socket mutation accepted");
    const addedRow = await getDatabaseRuntime().work((db) =>
      db("o_assets").where({ assetsId: 101, projectId: 1, name: "焚毁名册" }).first(),
    );
    assert.ok(addedRow);

    // 将新增资产更新为与 111 完全等价的状态：拒绝
    const collision = await harness.execute({
      assetsId: 101,
      id: addedRow.id,
      name: "焚毁名册",
      desc: "改写为浸湿",
      changeInstruction: PROP_CONDITION_INSTRUCTION,
    });
    assert.match(String(collision), /已存在等价.*衍生资产|复用/u);
    assert.equal(harness.socketEvents.length, 2, "等价改写不得触发前端 mutation");

    // 更新为保持自身不变的等价内容（自比较排除）：允许
    const selfUpdate = await harness.execute(propUpdate(111));
    assert.equal(selfUpdate, "socket mutation accepted", "更新自身不得因自比较被拒绝");
  });
});

test("镜头/构图/动作/表情等非法维度被工具拒绝", async () => {
  await withDataRoot("toonflow-derived-prohibited-dimensions-", async (dataRoot) => {
    await openDatabase({ dataRoot });
    await seedPropAssets();
    const harness = createAddDerivedAssetTool(1);

    for (const dimension of ["camera", "shot_scale", "framing", "expression", "gaze"] as const) {
      const rejected = await harness.execute({
        ...roleUpdate(null),
        changeInstruction: {
          dimensions: [dimension],
          evidence: ["第三幕：将军换上战甲。"],
          preserve: ["人物身份", "面部特征"],
          change: ["换上战甲"],
          exclude: [],
        } as unknown as AddDerivedAssetInput["changeInstruction"],
      });
      assert.match(String(rejected), /dimensions|维度/u, `非法维度 ${dimension} 必须被拒绝`);
    }
    assert.deepEqual(harness.socketEvents, [], "非法维度不得触发前端 mutation");
    const rows = await getDatabaseRuntime().work((db) => db("o_assets").where({ assetsId: 301, projectId: 1 }).select());
    assert.equal(rows.length, 1, "既有数据不受影响（项目一父资产 301 下仅原有 311）");
  });
});

test("Agent 写入的衍生资产必须携带剧本证据", async () => {
  await withDataRoot("toonflow-derived-evidence-required-", async (dataRoot) => {
    await openDatabase({ dataRoot });
    await seedPropAssets();
    const harness = createAddDerivedAssetTool(1);

    const rejected = await harness.execute({
      ...roleUpdate(null),
      changeInstruction: {
        dimensions: ["wardrobe"],
        evidence: [],
        preserve: ["人物身份", "面部特征"],
        change: ["换上战甲"],
        exclude: [],
      },
    });
    assert.match(String(rejected), /证据/u, "无剧本证据的衍生写入必须被拒绝");
    assert.deepEqual(harness.socketEvents, []);
  });
});
