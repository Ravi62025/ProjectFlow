import Activity from "../models/Activity.js";

// Activity is a convenience timeline, not a guaranteed audit log.
// Logging failures must never change the outcome of the primary operation.
const logActivity = async (details) => {
  try {
    await Activity.create(details);
  } catch (error) {
    console.error("Activity logging failed:", error.message);
  }
};

export default logActivity;
