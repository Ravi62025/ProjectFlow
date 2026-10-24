import { describe, test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { startTestDb, clearTestDb, stopTestDb } from "./helpers.js";
import User from "../src/models/User.js";
import Project from "../src/models/Project.js";
import Workspace from "../src/models/Workspace.js";
import Membership, { MEMBERSHIP_ROLES } from "../src/models/Membership.js";

// Model rules and database indexes. These tests use the models directly (no routes).
// The references (createdBy, workspace, user) are not checked against real documents
// by Mongoose, so most tests simply use fresh ObjectIds.

const newId = () => new mongoose.Types.ObjectId();

const isDuplicateKeyError = (error) => error?.code === 11000;

const validationErrorFor = async (document) => {
  try {
    await document.validate();
  } catch (error) {
    return error;
  }
  return null;
};

const findIndex = async (Model, key) => {
  const indexes = await Model.collection.indexes();
  return indexes.find((index) => JSON.stringify(index.key) === JSON.stringify(key));
};

describe("Workspace and Membership models", () => {
  before(startTestDb);
  after(stopTestDb);
  beforeEach(clearTestDb);

  describe("Workspace", () => {
    test("saves a workspace with defaults and timestamps", async () => {
      const createdBy = newId();
      const workspace = await Workspace.create({ name: "  Team Alpha  ", createdBy });

      assert.equal(workspace.name, "Team Alpha"); // trimmed
      assert.equal(String(workspace.createdBy), String(createdBy));
      assert.equal(workspace.isPersonal, false);
      assert.ok(workspace.createdAt instanceof Date);
      assert.ok(workspace.updatedAt instanceof Date);
    });

    test("requires a name that is not only spaces", async () => {
      for (const name of [undefined, "", "   "]) {
        const error = await validationErrorFor(new Workspace({ name, createdBy: newId() }));
        assert.equal(error?.name, "ValidationError", `name ${JSON.stringify(name)}`);
        assert.ok(error.errors.name);
      }
    });

    test("allows a name of 80 characters but not 81", async () => {
      const ok = await validationErrorFor(
        new Workspace({ name: "a".repeat(80), createdBy: newId() })
      );
      assert.equal(ok, null);

      const tooLong = await validationErrorFor(
        new Workspace({ name: "a".repeat(81), createdBy: newId() })
      );
      assert.equal(tooLong?.name, "ValidationError");
      assert.ok(tooLong.errors.name);
    });

    test("requires createdBy", async () => {
      const error = await validationErrorFor(new Workspace({ name: "No creator" }));
      assert.equal(error?.name, "ValidationError");
      assert.ok(error.errors.createdBy);
    });

    test("has a partial unique index on createdBy for personal workspaces", async () => {
      const index = await findIndex(Workspace, { createdBy: 1 });
      assert.ok(index, "the createdBy index should exist in the database");
      assert.equal(index.unique, true);
      assert.deepEqual(index.partialFilterExpression, { isPersonal: true });
    });

    test("a user cannot have two personal workspaces", async () => {
      const createdBy = newId();
      await Workspace.create({ name: "Personal", createdBy, isPersonal: true });

      await assert.rejects(
        Workspace.create({ name: "Another personal", createdBy, isPersonal: true }),
        isDuplicateKeyError
      );
      assert.equal(await Workspace.countDocuments({ createdBy }), 1);
    });

    test("a user can still have a personal workspace and any number of other workspaces", async () => {
      const createdBy = newId();
      await Workspace.create({ name: "Personal", createdBy, isPersonal: true });
      await Workspace.create({ name: "Team one", createdBy });
      await Workspace.create({ name: "Team two", createdBy });

      assert.equal(await Workspace.countDocuments({ createdBy }), 3);
    });

    test("different users can each have a personal workspace", async () => {
      await Workspace.create({ name: "A", createdBy: newId(), isPersonal: true });
      await Workspace.create({ name: "B", createdBy: newId(), isPersonal: true });
      assert.equal(await Workspace.countDocuments({ isPersonal: true }), 2);
    });
  });

  describe("Membership", () => {
    test("saves a membership for each allowed role", async () => {
      assert.deepEqual(MEMBERSHIP_ROLES, ["owner", "admin", "member"]);

      const workspace = newId();
      for (const role of MEMBERSHIP_ROLES) {
        const membership = await Membership.create({ workspace, user: newId(), role });
        assert.equal(membership.role, role);
        assert.ok(membership.createdAt instanceof Date);
        assert.ok(membership.updatedAt instanceof Date);
      }
    });

    test("rejects a role that is not allowed or missing", async () => {
      for (const role of ["viewer", "OWNER", "", undefined]) {
        const error = await validationErrorFor(
          new Membership({ workspace: newId(), user: newId(), role })
        );
        assert.equal(error?.name, "ValidationError", `role ${JSON.stringify(role)}`);
        assert.ok(error.errors.role);
      }
    });

    test("requires a workspace and a user", async () => {
      const noWorkspace = await validationErrorFor(new Membership({ user: newId(), role: "member" }));
      assert.ok(noWorkspace?.errors.workspace);

      const noUser = await validationErrorFor(new Membership({ workspace: newId(), role: "member" }));
      assert.ok(noUser?.errors.user);
    });

    test("has the expected indexes in the database", async () => {
      const pair = await findIndex(Membership, { workspace: 1, user: 1 });
      assert.ok(pair, "the { workspace, user } index should exist");
      assert.equal(pair.unique, true);

      const byUser = await findIndex(Membership, { user: 1 });
      assert.ok(byUser, "the { user } index should exist");
      assert.notEqual(byUser.unique, true);

      const owner = await findIndex(Membership, { workspace: 1 });
      assert.ok(owner, "the owner index should exist");
      assert.equal(owner.unique, true);
      assert.deepEqual(owner.partialFilterExpression, { role: "owner" });
    });

    test("a user cannot be added to the same workspace twice", async () => {
      const workspace = newId();
      const user = newId();
      await Membership.create({ workspace, user, role: "member" });

      await assert.rejects(
        Membership.create({ workspace, user, role: "admin" }),
        isDuplicateKeyError
      );
      assert.equal(await Membership.countDocuments({ workspace, user }), 1);
    });

    test("the same user can belong to different workspaces", async () => {
      const user = newId();
      await Membership.create({ workspace: newId(), user, role: "owner" });
      await Membership.create({ workspace: newId(), user, role: "owner" });
      await Membership.create({ workspace: newId(), user, role: "member" });
      assert.equal(await Membership.countDocuments({ user }), 3);
    });

    test("a workspace cannot have two owners", async () => {
      const workspace = newId();
      await Membership.create({ workspace, user: newId(), role: "owner" });

      await assert.rejects(
        Membership.create({ workspace, user: newId(), role: "owner" }),
        isDuplicateKeyError
      );
      assert.equal(await Membership.countDocuments({ workspace, role: "owner" }), 1);
    });

    test("a workspace can have many admins and members besides its owner", async () => {
      const workspace = newId();
      await Membership.create({ workspace, user: newId(), role: "owner" });
      await Membership.create({ workspace, user: newId(), role: "admin" });
      await Membership.create({ workspace, user: newId(), role: "admin" });
      await Membership.create({ workspace, user: newId(), role: "member" });
      await Membership.create({ workspace, user: newId(), role: "member" });
      assert.equal(await Membership.countDocuments({ workspace }), 5);
    });

    test("different workspaces can each have an owner", async () => {
      await Membership.create({ workspace: newId(), user: newId(), role: "owner" });
      await Membership.create({ workspace: newId(), user: newId(), role: "owner" });
      assert.equal(await Membership.countDocuments({ role: "owner" }), 2);
    });

    test("the owner index limits owners to one but does not require one", async () => {
      // A workspace that only has a member is accepted by the database. Keeping an owner
      // in place is the job of the code that changes memberships.
      const workspace = newId();
      await Membership.create({ workspace, user: newId(), role: "member" });
      assert.equal(await Membership.countDocuments({ workspace, role: "owner" }), 0);
    });
  });

  describe("Project.workspace", () => {
    test("is optional: a project without a workspace is still valid", async () => {
      const project = await Project.create({ name: "Legacy project", owner: newId() });
      assert.equal(project.workspace, undefined);

      const stored = await Project.findById(project._id).lean();
      assert.equal("workspace" in stored, false);
    });

    test("can hold a workspace reference, and owner is unchanged", async () => {
      const owner = newId();
      const workspace = newId();
      const project = await Project.create({ name: "New project", owner, workspace });

      assert.equal(String(project.workspace), String(workspace));
      assert.equal(String(project.owner), String(owner));
    });

    test("still requires an owner", async () => {
      const error = await validationErrorFor(new Project({ name: "No owner", workspace: newId() }));
      assert.equal(error?.name, "ValidationError");
      assert.ok(error.errors.owner);
    });
  });

  test("User documents are unchanged by these models", async () => {
    const user = await User.create({
      name: "Plain User",
      email: "plain@example.com",
      password: "password123",
    });
    assert.deepEqual(
      Object.keys(user.toObject()).sort(),
      ["__v", "_id", "createdAt", "email", "name", "password", "updatedAt"]
    );
  });
});