import { DataTypes, Model, type Sequelize } from "sequelize";

export class Run extends Model {
  declare run_id: string;
  declare customer_id: string;
  declare created_at: Date;
  declare updated_at: Date;
  declare stage: string;
  declare source_filename: string;
  declare source_mime: string;
  declare extraction_json: string | null;
  declare extraction_raw_json: string | null;
  declare validation_json: string | null;
  declare decision_json: string | null;
  declare decision_kind: string | null;
  declare flagged_human: number;
  declare estimated_cost_usd: number | null;
  declare error_message: string | null;
}

export function initRunModel(sequelize: Sequelize): typeof Run {
  Run.init(
    {
      run_id: { type: DataTypes.TEXT, primaryKey: true },
      customer_id: { type: DataTypes.TEXT, allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
      stage: { type: DataTypes.TEXT, allowNull: false },
      source_filename: { type: DataTypes.TEXT, allowNull: false },
      source_mime: { type: DataTypes.TEXT, allowNull: false },
      extraction_json: DataTypes.TEXT,
      extraction_raw_json: DataTypes.TEXT,
      validation_json: DataTypes.TEXT,
      decision_json: DataTypes.TEXT,
      decision_kind: DataTypes.TEXT,
      flagged_human: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      estimated_cost_usd: DataTypes.DOUBLE,
      error_message: DataTypes.TEXT,
    },
    {
      sequelize,
      tableName: "runs",
      modelName: "Run",
      timestamps: false,
    }
  );
  return Run;
}
