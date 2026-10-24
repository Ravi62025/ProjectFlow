import express from "express";
import cors from "cors";
import authRoutes from "./routes/authRoutes.js";
import projectRoutes from "./routes/projectRoutes.js";
import taskRoutes from "./routes/taskRoutes.js";
import activityRoutes from "./routes/activityRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import myTaskRoutes from "./routes/myTaskRoutes.js";

// The Express app only. It does not connect to MongoDB or listen on a port,
// so tests can import it. src/index.js starts the real server.
const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ message: "ProjectFlow API is running" });
});

app.use("/api/auth", authRoutes);
app.use("/api/tasks", myTaskRoutes);
app.use("/api/projects/:projectId/tasks", taskRoutes);
app.use("/api/projects/:projectId/activity", activityRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/projects", projectRoutes);

// Any request that matched no route
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// Turns every error into JSON. Only safe, intended messages are sent to the client;
// anything else is logged on the server and answered with a generic message.
export const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  // Malformed JSON body (from express.json)
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Invalid JSON in request body" });
  }

  // Other client errors raised by Express itself (for example a body that is too large)
  const status = err?.status ?? err?.statusCode;
  if (Number.isInteger(status) && status >= 400 && status < 500 && err.expose) {
    return res.status(status).json({ message: err.message });
  }

  console.error("Unhandled error:", err);
  return res.status(500).json({ message: "Server error" });
};

app.use(errorHandler);

export default app;