import mongoose from "mongoose";

export const ACTIVITY_TYPES = [
  "task_created",
  "task_updated",
  "task_status_changed",
  "task_deleted",
  "project_created",
  "project_updated",
];

const activitySchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: ACTIVITY_TYPES,
      required: true,
    },
    // Intentionally not a ref: keep the ID/title snapshot after task deletion.
    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      default: undefined,
    },
    taskTitle: {
      type: String,
      default: "",
    },
    projectName: {
      type: String,
      default: "",
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

activitySchema.index({ project: 1, createdAt: -1 });

const Activity = mongoose.model("Activity", activitySchema);

export default Activity;
