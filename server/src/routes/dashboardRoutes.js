import express from "express";
import mongoose from "mongoose";
import protect from "../middleware/authMiddleware.js";
import Project from "../models/Project.js";
import Task from "../models/Task.js";

const router = express.Router();

// Every route in this file requires a valid token
router.use(protect);

// The task status values used by the Task model
const TODO = "To Do";
const IN_PROGRESS = "In Progress";
const DONE = "Done";

// done / total as a whole percentage, rounded down, so 100 means every task is done.
// Written as (done * 100) / total to avoid floating point errors such as 29/100*100.
const completionPercent = (done, total) =>
    total > 0 ? Math.floor((done * 100) / total) : 0;

// Start of the current UTC calendar day. Due dates are stored as UTC midnight of the
// due day, so a task due today is not overdue and a task due yesterday is.
const startOfTodayUtc = () => {
    const now = new Date();
    return new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
};

// Task statistics for the logged-in user, across all of their projects.
// Read-only: nothing here changes any data.
router.get("/stats", async (req, res) => {
    try {
        const ownerId = new mongoose.Types.ObjectId(req.user.id);

        // 1. The user's own projects, newest first (the same order as GET /api/projects)
        const projects = await Project.find({ owner: ownerId })
            .sort({ createdAt: -1, _id: -1 })
            .select("_id name")
            .lean();

        // 2. Count tasks. Only tasks of these projects are counted, so tasks left behind
        // by deleted projects (orphans) and tasks of other users are never included.
        let groups = [];
        let overdueTasks = 0;

        if (projects.length > 0) {
            const taskFilter = {
                project: { $in: projects.map((project) => project._id) },
                owner: ownerId,
            };

            [groups, overdueTasks] = await Promise.all([
                // one row per project and status, instead of one request per project
                Task.aggregate([
                    { $match: taskFilter },
                    {
                        $group: {
                            _id: { project: "$project", status: "$status" },
                            count: { $sum: 1 },
                        },
                    },
                ]),
                // $lt with a Date never matches tasks that have no due date
                Task.countDocuments({
                    ...taskFilter,
                    status: { $ne: DONE },
                    dueDate: { $lt: startOfTodayUtc() },
                }),
            ]);
        }

        // 3. Add up the counts: overall and per project
        let totalTasks = 0;
        let todoTasks = 0;
        let inProgressTasks = 0;
        let completedTasks = 0;
        const perProject = new Map(); // project id -> { total, done }

        for (const { _id, count } of groups) {
            totalTasks += count;
            if (_id.status === TODO) todoTasks += count;
            else if (_id.status === IN_PROGRESS) inProgressTasks += count;
            else if (_id.status === DONE) completedTasks += count;

            const key = String(_id.project);
            const entry = perProject.get(key) || { total: 0, done: 0 };
            entry.total += count;
            if (_id.status === DONE) entry.done += count;
            perProject.set(key, entry);
        }

        const projectProgress = projects.map((project) => {
            const entry = perProject.get(String(project._id)) || { total: 0, done: 0 };
            return {
                projectId: project._id,
                name: project.name,
                totalTasks: entry.total,
                completedTasks: entry.done,
                completionPercent: completionPercent(entry.done, entry.total),
            };
        });

        return res.json({
            taskStats: {
                totalTasks,
                todoTasks,
                inProgressTasks,
                completedTasks,
                activeTasks: todoTasks + inProgressTasks,
                overdueTasks,
                overallProgress: completionPercent(completedTasks, totalTasks),
            },
            projectProgress,
        });
    } catch (error) {
        console.error("Dashboard stats error:", error.message);
        return res.status(500).json({ message: "Server error" });
    }
});

export default router;