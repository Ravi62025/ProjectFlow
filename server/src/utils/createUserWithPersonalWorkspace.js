import User from "../models/User.js";
import Workspace from "../models/Workspace.js";
import Membership from "../models/Membership.js";

// Creates a user together with their personal workspace and an owner membership.
//
// Why not a MongoDB transaction: transactions need a replica set, and the in-memory test
// database is a single server, so a transaction path could not be tested. This function
// uses one path everywhere instead: create the three documents in order, and if a later
// step fails, delete what was already created.
//
// The cleanup also covers a write that reached the database but whose success was never
// reported (for example a lost network response), so it deletes by the IDs that belong to
// this registration attempt instead of relying on documents the create calls returned.
// Every filter uses the ID of the user created a moment ago, or of the workspace created
// for that user, so no document of an existing user or workspace can match.
//
// What this does NOT cover: if the server process dies between two steps, nothing can run
// the cleanup. A user without a personal workspace, or a personal workspace without an
// owner membership, is then left behind. The same is true if a cleanup step itself fails.
// The workspace migration (a later step) finds and repairs these cases.

const SUFFIX = "'s Workspace";
const MAX_NAME_LENGTH = 80; // the Workspace name limit

// "<name>'s Workspace", shortened if the user's name is very long
export const personalWorkspaceName = (userName) => {
  const base = String(userName)
    .trim()
    .slice(0, MAX_NAME_LENGTH - SUFFIX.length)
    .trim();
  return `${base}${SUFFIX}`;
};

// Runs one cleanup step. A failure is logged with enough detail to repair it by hand,
// and never stops the other steps.
const cleanup = async (label, id, step) => {
  try {
    await step();
  } catch (error) {
    console.error(`Registration cleanup failed (${label} ${id}):`, error.message);
  }
};

const createUserWithPersonalWorkspace = async ({ name, email, password }) => {
  // If this fails nothing was created yet, so the error goes straight to the caller
  // unchanged (validation errors and duplicate emails keep their existing handling).
  const user = await User.create({ name, email, password });

  let workspace = null;

  try {
    workspace = await Workspace.create({
      name: personalWorkspaceName(user.name),
      createdBy: user._id,
      isPersonal: true,
    });
    await Membership.create({
      workspace: workspace._id,
      user: user._id,
      role: "owner",
    });
    return user;
  } catch (error) {
    console.error("Personal workspace setup failed:", error.message);

    // Undo in reverse order of creation. Each step is best-effort and independent.

    // 1. Memberships of the workspace created for this user. Skipped only when the
    // workspace ID is unknown, because then no membership has been attempted yet. If the
    // ID is known this always runs, even when the membership step threw, because that
    // write may have been saved anyway.
    if (workspace) {
      await cleanup("membership", workspace._id, () =>
        Membership.deleteMany({ workspace: workspace._id })
      );
    }

    // 2. The personal workspace of this user. This does not need the workspace ID, so it
    // also removes a workspace whose create call threw after the write was saved. A user
    // has at most one personal workspace (unique index), so one delete is enough.
    await cleanup("workspace", user._id, () =>
      Workspace.deleteOne({ createdBy: user._id, isPersonal: true })
    );

    // 3. The user created by this attempt
    await cleanup("user", user._id, () => User.deleteOne({ _id: user._id }));

    // A plain error, so the route answers 500 "Server error". The original error is not
    // passed on as is, because a duplicate-key (11000) or validation error from the
    // workspace step would be mistaken for "email already registered" or a bad request.
    throw new Error("Could not create the personal workspace", { cause: error });
  }
};

export default createUserWithPersonalWorkspace;