import { Knex } from "knex";

export default async (knex: Knex): Promise<void> => {
  const videoHasTime = await knex.schema.hasColumn("t_video", "time");
  if (!videoHasTime) {
    await knex.schema.alterTable("t_video", (table) => {
      table.integer("time");
    });
  }

  const configHasIndex = await knex.schema.hasColumn("t_config", "index");
  if (configHasIndex) {
    await knex.schema.alterTable("t_config", (table) => {
      table.dropColumn("index");
    });
  }
};
