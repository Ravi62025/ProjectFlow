import express from "express";
import protect from "../middleware/authMiddleware.js";
import Project from "../models/Project.js";
import Activity from "../models/Activity.js";

const router = express.Router({ mergeParams: true });

const isValidId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

router.use(protect);

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
    return next();
  } catch (error) {
    console.error("Activity project check error:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
});

router.get("/", async (req, res) => {
  try {
    const parsedLimit = Number(req.query.limit);
    const limit =
      Number.isInteger(parsedLimit) && parsedLimit >= 1
        ? Math.min(parsedLimit, 50)
        : 20;

    const activities = await Activity.find({ project: req.project._id })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .select("_id type taskId taskTitle projectName meta createdAt")
      .lean();

    return res.json({ activities });
  } catch (error) {
    console.error("List project activity error:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
