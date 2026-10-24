import mongoose from "mongoose";

export const MEMBERSHIP_ROLES = ["owner", "admin", "member"];

const membershipSchema = new mongoose.Schema(
  {
    workspace: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    role: {
      type: String,
      enum: MEMBERSHIP_ROLES,
      required: true,
    },
  },
  { timestamps: true }
);

// A user can be a member of a workspace only once.
membershipSchema.index({ workspace: 1, user: 1 }, { unique: true });

// Lists the workspaces a user belongs to.
membershipSchema.index({ user: 1 });

// At most one owner per workspace. This only guarantees "not more than one": a workspace
// with no owner is still possible, because the database cannot require a document to
// exist. The code that changes memberships must always keep an owner in place (for
// example by refusing to remove or demote the last owner).
membershipSchema.index(
  { workspace: 1 },
  { unique: true, partialFilterExpression: { role: "owner" } }
);

const Membership = mongoose.model("Membership", membershipSchema);

export default Membership;