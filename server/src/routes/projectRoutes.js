import express from "express";
import protect from "../middleware/authMiddleware.js";
import Project, { PROJECT_STATUSES } from "../models/Project.js";
import Task from "../models/Task.js";
import Activity from "../models/Activity.js";
import logActivity from "../utils/logActivity.js";

const router = express.Router();

// Every route in this file requires a valid token
router.use(protect);

const isValidId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

const comparableValue = (value) =>
  typeof value === "string" ? value.trim() : value;

// Returns an error message, or null if the fields are valid.
// Only fields present in the body are checked.
const validateFields = ({ name, description, status }) => {
  if (name !== undefined && (typeof name !== "string" || name.trim() === "")) {
    return "Project name must be a non-empty string";
  }
  if (description !== undefined && typeof description !== "string") {
    return "Description must be a string";
  }
  if (status !== undefined && !PROJECT_STATUSES.includes(status)) {
    return `Status must be one of: ${PROJECT_STATUSES.join(", ")}`;
  }
  return null;
};

// Only these fields can come from the client. Owner never can.
const pickFields = ({ name, description, status }) => {
  const fields = {};
  if (name !== undefined) fields.name = name;
  if (description !== undefined) fields.description = description;
  if (status !== undefined) fields.status = status;
  return fields;
};

// List the logged-in user's projects
router.get("/", async (req, res) => {
  try {
    const projects = await Project.find({ owner: req.user.id }).sort({
      createdAt: -1,
    });
    return res.json({ projects });
  } catch (error) {
    console.error("List projects error:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
});

// Create a project owned by the logged-in user
router.post("/", async (req, res) => {
  try {
    const body = req.body ?? {};

    if (body.name === undefined) {
      return res.status(400).json({ message: "Project name is required" });
    }
    const validationError = validateFields(body);
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const project = await Project.create({
      ...pickFields(body),
      owner: req.user.id,
    });

    await logActivity({
      project: project._id,
      actor: req.user.id,
      type: "project_created",
      projectName: project.name,
      meta: {},
    });

    return res.status(201).json({ project });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ message: error.message });
    }
    console.error("Create project error:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
});

// Get one owned project
router.get("/:id", async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid project ID" });
    }

    const project = await Project.findOne({
      _id: req.params.id,
      owner: req.user.id,
    });
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    return res.json({ project });
  } catch (error) {
    console.error("Get project error:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
});

// Update an owned project
router.put("/:id", async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid project ID" });
    }

    const body = req.body ?? {};
    const validationError = validateFields(body);
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const project = await Project.findOne({
      _id: req.params.id,
      owner: req.user.id,
    });
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    const fields = pickFields(body);
    const changedFields = Object.keys(fields).filter(
      (key) => comparableValue(project[key]) !== comparableValue(fields[key])
    );

    project.set(fields);
    await project.save();

    if (changedFields.length > 0) {
      await logActivity({
        project: project._id,
        actor: req.user.id,
        type: "project_updated",
        projectName: project.name,
        meta: { changed: changedFields },
      });
    }

    return res.json({ project });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ message: error.message });
    }
    console.error("Update project error:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
});

// Delete an owned project
router.delete("/:id", async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid project ID" });
    }

    // 1. Confirm the project belongs to the logged-in user. Nothing is deleted before this.
    const owned = await Project.findOne({
      _id: req.params.id,
      owner: req.user.id,
    });
    if (!owned) {
      return res.status(404).json({ message: "Project not found" });
    }

    // 2. Delete the project's tasks first. If this fails, the project is still there
    // and the request can be repeated, so tasks are never left without a project.
    await Task.deleteMany({ project: owned._id });

    // 3. Delete the project (the ownership filter stays, as a safeguard)
    const project = await Project.findOneAndDelete({
      _id: req.params.id,
      owner: req.user.id,
    });
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    // A deleted project cannot serve its timeline. Cleanup is best-effort.
    try {
      await Activity.deleteMany({ project: project._id });
    } catch (error) {
      console.error("Project activity cleanup failed:", error.message);
    }

    return res.json({ message: "Project deleted" });
  } catch (error) {
    console.error("Delete project error:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;