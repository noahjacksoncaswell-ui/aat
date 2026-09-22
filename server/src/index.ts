import "express-async-errors";
import express from "express";
import http from "http";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env";
import { requireAuth } from "./middleware/auth";
import { initWebsocket } from "./websocket";
import { startHoldScheduler } from "./services/holdScheduler";

import authRoutes from "./routes/auth";
import userRoutes from "./routes/users";
import siteRoutes from "./routes/sites";
import vehicleRoutes from "./routes/vehicles";
import missionRoutes from "./routes/missions";
import coaRoutes from "./routes/coa";
import notamRoutes from "./routes/notam";
import notificationRoutes from "./routes/notifications";
import documentRoutes from "./routes/documents";
import adminRoutes from "./routes/admin";
import dashboardRoutes from "./routes/dashboard";
import faaSummaryRoutes from "./routes/faaSummary";
import countdownRoutes from "./routes/countdown";
import lwccRoutes from "./routes/lwcc";

const app = express();
app.use(helmet());
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json({ limit: "5mb" }));

app.get("/health", (_req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

// Public
app.use("/api/auth", authRoutes);

// Authenticated
app.use("/api/users", requireAuth, userRoutes);
app.use("/api/sites", requireAuth, siteRoutes);
app.use("/api/vehicles", requireAuth, vehicleRoutes);
app.use("/api/missions", requireAuth, missionRoutes);
app.use("/api/missions/:missionId/notam", requireAuth, notamRoutes);
app.use("/api/missions/:missionId/notifications", requireAuth, notificationRoutes);
app.use("/api/missions/:missionId/countdown", requireAuth, countdownRoutes);
app.use("/api/missions/:missionId/lwcc", requireAuth, lwccRoutes);
app.use("/api/coa", requireAuth, coaRoutes);
app.use("/api/documents", requireAuth, documentRoutes);
app.use("/api/admin", requireAuth, adminRoutes);
app.use("/api/dashboard", requireAuth, dashboardRoutes);
app.use("/api/faa", requireAuth, faaSummaryRoutes);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // eslint-disable-next-line no-console
  console.error(err);
  const status = err.status ?? 500;
  res.status(status).json({ error: err.message ?? "Internal server error" });
});

const httpServer = http.createServer(app);
initWebsocket(httpServer);

httpServer.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`AAT LOD API listening on port ${env.port} (${env.nodeEnv})`);
});

// v4.1 Item 1 - server-side hold scheduler, the sole source of truth for
// programmed-hold triggering and Item 2's Auto-Proceed release, running
// independent of any connected client (see services/holdScheduler.ts).
startHoldScheduler();
