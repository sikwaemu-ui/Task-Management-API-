import cors from "cors";
import { RuntimeConfig } from "../config/env";
import { ForbiddenError } from "../utils/errors";

export const createCorsMiddleware = (config: RuntimeConfig) => cors({
  origin(origin, callback) {
    // Non-browser clients do not send Origin and are governed by API auth instead.
    if (!origin) {
      callback(null, true);
      return;
    }
    if (config.corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new ForbiddenError("Origin is not allowed by CORS"));
  },
  methods: ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
});
