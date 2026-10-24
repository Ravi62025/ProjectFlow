import mongoose from "mongoose";

export const WORKSPACE_NAME_MAX_LENGTH = 80;

const workspaceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: WORKSPACE_NAME_MAX_LENGTH,
    },
    // The user who created the workspace. Informational only: who may do what in a
    // workspace is decided by Membership, not by this field.
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    isPersonal: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// A user can have at most one personal workspace. The index only covers documents where
// isPersonal is true, so a user can still create any number of other workspaces.
workspaceSchema.index(
  { createdBy: 1 },
  { unique: true, partialFilterExpression: { isPersonal: true } }
);

const Workspace = mongoose.model("Workspace", workspaceSchema);

export default Workspace;