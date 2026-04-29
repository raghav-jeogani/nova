import { Sequelize } from "sequelize";
import { initRunModel } from "./models/run.js";

function databaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is required (PostgreSQL connection string)");
  }
  return url;
}

export const sequelize = new Sequelize(databaseUrl(), {
  dialect: "postgres",
  logging: false,
  pool: { max: Number(process.env.PG_POOL_MAX ?? 10) },
});

export const Run = initRunModel(sequelize);

/** Create tables if missing (matches prior raw DDL) and idempotent indexes. */
export async function initDb(): Promise<void> {
  await sequelize.authenticate();
  await sequelize.sync({ alter: false });
  await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs (created_at DESC);`);
  await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_runs_decision_kind ON runs (decision_kind);`);
  await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_runs_flagged ON runs (flagged_human);`);
}
