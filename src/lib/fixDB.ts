import { Knex } from "knex";

export default async (knex: Knex): Promise<void> => {
  const hasTime = await knex.schema.hasColumn("t_video", "time");
  if (!hasTime) {
    await knex.schema.alterTable("t_video", (table) => {
      table.integer("time");
    });
    console.log("字段 'time' 已添加到 t_video 表");
  } else {
    console.log("t_video 表已存在 'time' 字段");
  }
};
