import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config({ path: ".env.local" });

const connectionString = process.env.DATABASE_URL_DEV;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL_DEV no está definida. Debe estar en .env.local (nunca versionado) o en el entorno del proceso."
  );
}

export const pool = new Pool({ connectionString });
