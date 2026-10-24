import express from "express";
import protect from "../middleware/authMiddleware.js";
import Project from "../models/Project.js";
import Task from "../models/Task.js";

const router = express.Router();

// Every route in this file requires a valid token
router.use(protect);

// List every task of the logged-in user, across all of their projects, newest first.
// Each task has the same fields as in the project task list, except that `project`
// is an object ({ _id, name }) instead of just the project id.
router.get("/", async (req, res) => {
    try {
        // 1. The user's own projects. Only tasks of these projects can be returned, so tasks
        // of other users' projects, and tasks whose project was deleted, are never included.
        const projects = await Project.find({ owner: req.user.id })
            .select("_id name")
            .lean();

        if (projects.length === 0) {
            return res.json({ tasks: [] });
        }

        const projectById = new Map(
            projects.map((project) => [String(project._id), project])
        );

        // 2. All tasks of those projects in one query (no query per project).
        // _id is a tie-breaker so tasks created at the same moment keep a stable order.
        const tasks = await Task.find({
            project: { $in: projects.map((project) => project._id) },
            owner: req.user.id,
        }).sort({ createdAt: -1, _id: -1 });

        // 3. Replace the project id with { _id, name }, keeping all other task fields as they are
        const result = [];
        for (const task of tasks) {
            const project = projectById.get(String(task.project));
            if (!project) continue; // cannot happen after the query above, but never guess a name

            result.push({
                ...task.toJSON(),
                project: { _id: String(project._id), name: project.name },
            });
        }

        return res.json({ tasks: result });
    } catch (error) {
        console.error("List all tasks error:", error.message);
        return res.status(500).json({ message: "Server error" });
    }
});

export default router;