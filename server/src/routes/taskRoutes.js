import express from "express";
import protect from "../middleware/authMiddleware.js";
import Project from "../models/Project.js";
import Task, { TASK_STATUSES, TASK_PRIORITIES } from "../models/Task.js";
import logActivity from "../utils/logActivity.js";

// mergeParams makes :projectId from the mount path available here
const router = express.Router({ mergeParams: true });

const isValidId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

// Compare values in the same form the schemas persist them in.
const comparableValue = (key, value) => {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    if (key === "dueDate") {
        const date = value instanceof Date ? value : new Date(value);
        return Number.isNaN(date.getTime()) ? value : date.getTime();
    }
    if (typeof value === "string") return value.trim();
    return value;
};

// 1. Require a valid token
router.use(protect);

// 2. Validate :projectId and confirm the project belongs to the logged-in user
router.use(async (req, res, next) => {
    try {
        const { projectId } = req.params;

        if (!isValidId(projectId)) {
            return res.status(400).json({ message: "Invalid project ID" });
        }

        const project = await Project.findOne({
            _id: projectId,
            owner: req.user.id,
        });
        if (!project) {
            return res.status(404).json({ message: "Project not found" });
        }

        req.project = project;
        next();
    } catch (error) {
        console.error("Task project check error:", error.message);
        return res.status(500).json({ message: "Server error" });
    }
});

// Accepts only YYYY-MM-DD. Returns a Date at 00:00:00 UTC, or null if invalid.
const DUE_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const parseDueDate = (value) => {
    if (typeof value !== "string") return null;
    const match = DUE_DATE_PATTERN.exec(value);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year < 1) return null;

    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) {
        return null;
    }

    return date;
};

// Returns an error message, or null if valid.
// partial = true (updates): only fields that are present are checked.
const validateTask = (body, { partial = false } = {}) => {
    const { title, description, status, priority, dueDate } = body;

    if (!partial || title !== undefined) {
        if (typeof title !== "string" || title.trim() === "") {
            return partial ? "Task title cannot be empty" : "Task title is required";
        }
    }
    if (description !== undefined && typeof description !== "string") {
        return "Description must be a string";
    }
    if (status !== undefined && !TASK_STATUSES.includes(status)) {
        return `Status must be one of: ${TASK_STATUSES.join(", ")}`;
    }
    if (priority !== undefined && !TASK_PRIORITIES.includes(priority)) {
        return `Priority must be one of: ${TASK_PRIORITIES.join(", ")}`;
    }
    if (dueDate !== undefined && dueDate !== null && dueDate !== "") {
        if (typeof dueDate !== "string" || parseDueDate(dueDate) === null) {
            return "Due date must be a valid date in YYYY-MM-DD format";
        }
    }
    return null;
};

// List tasks of the project, newest first
router.get("/", async (req, res) => {
    try {
        const tasks = await Task.find({
            project: req.project._id,
            owner: req.user.id,
        }).sort({ createdAt: -1 });

        return res.json({ tasks });
    } catch (error) {
        console.error("List tasks error:", error.message);
        return res.status(500).json({ message: "Server error" });
    }
});

// Create a task in the project
router.post("/", async (req, res) => {
    try {
        const body = req.body ?? {};

        const validationError = validateTask(body);
        if (validationError) {
            return res.status(400).json({ message: validationError });
        }

        const { title, description, status, priority, dueDate } = body;

        const task = await Task.create({
            title,
            description,
            status,
            priority,
            dueDate: dueDate ? parseDueDate(dueDate) : null,
            project: req.project._id,
            owner: req.user.id,
        });

        await logActivity({
            project: req.project._id,
            actor: req.user.id,
            type: "task_created",
            taskId: task._id,
            taskTitle: task.title,
            projectName: req.project.name,
            meta: {},
        });

        return res.status(201).json({ task });
    } catch (error) {
        if (error.name === "ValidationError") {
            return res.status(400).json({ message: error.message });
        }
        console.error("Create task error:", error.message);
        return res.status(500).json({ message: "Server error" });
    }
});

// Update a task of the project
router.put("/:taskId", async (req, res) => {
    try {
        const { taskId } = req.params;
        if (!isValidId(taskId)) {
            return res.status(400).json({ message: "Invalid task ID" });
        }

        const body = req.body ?? {};

        const validationError = validateTask(body, { partial: true });
        if (validationError) {
            return res.status(400).json({ message: validationError });
        }

        const updates = {};
        for (const key of ["title", "description", "status", "priority"]) {
            if (body[key] !== undefined) updates[key] = body[key];
        }
        if (body.dueDate !== undefined) {
            updates.dueDate = body.dueDate ? parseDueDate(body.dueDate) : null;
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ message: "No valid fields to update" });
        }

        const task = await Task.findOne({
            _id: taskId,
            project: req.project._id,
            owner: req.user.id,
        });
        if (!task) {
            return res.status(404).json({ message: "Task not found" });
        }

        const oldStatus = task.status;
        const changedFields = Object.keys(updates).filter(
            (key) =>
                comparableValue(key, task[key]) !==
                comparableValue(key, updates[key])
        );

        task.set(updates);
        await task.save();

        if (changedFields.length > 0) {
            const statusChanged = changedFields.includes("status");
            const meta = { changed: changedFields };
            if (statusChanged) {
                meta.from = oldStatus;
                meta.to = task.status;
            }

            await logActivity({
                project: req.project._id,
                actor: req.user.id,
                type: statusChanged ? "task_status_changed" : "task_updated",
                taskId: task._id,
                taskTitle: task.title,
                projectName: req.project.name,
                meta,
            });
        }

        return res.json({ task });
    } catch (error) {
        if (error.name === "ValidationError") {
            return res.status(400).json({ message: error.message });
        }
        console.error("Update task error:", error.message);
        return res.status(500).json({ message: "Server error" });
    }
});

// Delete a task of the project
router.delete("/:taskId", async (req, res) => {
    try {
        const { taskId } = req.params;
        if (!isValidId(taskId)) {
            return res.status(400).json({ message: "Invalid task ID" });
        }

        const task = await Task.findOneAndDelete({
            _id: taskId,
            project: req.project._id,
            owner: req.user.id,
        });
        if (!task) {
            return res.status(404).json({ message: "Task not found" });
        }

        await logActivity({
            project: req.project._id,
            actor: req.user.id,
            type: "task_deleted",
            taskId: task._id,
            taskTitle: task.title,
            projectName: req.project.name,
            meta: {},
        });

        return res.json({ message: "Task deleted" });
    } catch (error) {
        console.error("Delete task error:", error.message);
        return res.status(500).json({ message: "Server error" });
    }
});

export default router;
