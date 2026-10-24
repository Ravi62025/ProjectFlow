import { describe, test, before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { startTestDb, clearTestDb, stopTestDb, TEST_JWT_SECRET } from "./helpers.js";
import app from "../src/app.js";
import User from "../src/models/User.js";
import Workspace from "../src/models/Workspace.js";
import Membership from "../src/models/Membership.js";

// Registration creates the user, a personal workspace and an owner membership together.

const USER = { name: "Test User", email: "test@example.com", password: "password123" };

const register = (body = USER) => request(app).post("/api/auth/register").send(body);

const counts = async () => ({
  users: await User.countDocuments(),
  workspaces: await Workspace.countDocuments(),
  memberships: await Membership.countDocuments(),
});

// Makes a model method fail, and keeps the expected error output out of the test log.
// Returns a function that puts everything back.
const breakMethod = (Model, method) => {
  const failing = mock.method(Model, method, async () => {
    throw new Error(`simulated ${method} failure`);
  });
  const logged = mock.method(console, "error", () => {});
  return () => {
    failing.mock.restore();
    logged.mock.restore();
  };
};

// Makes `Model.create` save the document and then throw, like a write whose success
// message was lost. `written` collects the IDs that really were saved, so a test can
// prove the write happened. Returns the mock; call `.mock.restore()` when done.
const persistThenThrow = (Model, written) => {
  const original = Model.create.bind(Model);
  return mock.method(Model, "create", async (...args) => {
    const saved = await original(...args);
    written.push(saved._id);
    throw new Error("simulated lost response");
  });
};

// Wraps a model method so every call is recorded and then passed on to the real method
const spyOn = (Model, method, name, events) => {
  const original = Model[method].bind(Model);
  return mock.method(Model, method, (filter) => {
    events.push({ name, filter: JSON.parse(JSON.stringify(filter)) });
    return original(filter);
  });
};

// Everything stored in the three collections, in a stable order
const everything = async () =>
  JSON.stringify({
    users: await User.find().sort({ _id: 1 }).lean(),
    workspaces: await Workspace.find().sort({ _id: 1 }).lean(),
    memberships: await Membership.find().sort({ _id: 1 }).lean(),
  });

describe("registration and the personal workspace", () => {
  before(startTestDb);
  after(stopTestDb);
  beforeEach(clearTestDb);

  describe("when it works", () => {
    test("keeps the existing response: 201 with only id, name and email", async () => {
      const res = await register();
      assert.equal(res.status, 201);
      assert.deepEqual(Object.keys(res.body).sort(), ["email", "id", "name"]);
      assert.equal(res.body.name, USER.name);
      assert.equal(res.body.email, USER.email);
      assert.match(res.body.id, /^[0-9a-f]{24}$/);
    });

    test("creates exactly one personal workspace and one owner membership", async () => {
      const res = await register();
      assert.equal(res.status, 201);
      assert.deepEqual(await counts(), { users: 1, workspaces: 1, memberships: 1 });

      const workspace = await Workspace.findOne().lean();
      assert.equal(workspace.name, "Test User's Workspace");
      assert.equal(workspace.isPersonal, true);
      assert.equal(String(workspace.createdBy), res.body.id);

      const membership = await Membership.findOne().lean();
      assert.equal(String(membership.workspace), String(workspace._id));
      assert.equal(String(membership.user), res.body.id);
      assert.equal(membership.role, "owner");
    });

    test("gives every user their own workspace", async () => {
      const first = await register();
      const second = await register({ ...USER, name: "Second", email: "second@example.com" });
      assert.equal(first.status, 201);
      assert.equal(second.status, 201);

      assert.deepEqual(await counts(), { users: 2, workspaces: 2, memberships: 2 });
      for (const id of [first.body.id, second.body.id]) {
        assert.equal(await Workspace.countDocuments({ createdBy: id, isPersonal: true }), 1);
        assert.equal(await Membership.countDocuments({ user: id, role: "owner" }), 1);
      }
    });

    test("a very long name still registers, with a workspace name within the limit", async () => {
      const longName = "N".repeat(200);
      const res = await register({ ...USER, name: longName });
      assert.equal(res.status, 201);
      assert.equal(res.body.name, longName);

      const workspace = await Workspace.findOne().lean();
      assert.ok(workspace.name.length <= 80);
      assert.ok(workspace.name.endsWith("'s Workspace"));
    });

    test("login and /me work as before for a registered user", async () => {
      const registered = await register();
      const login = await request(app)
        .post("/api/auth/login")
        .send({ email: USER.email, password: USER.password });
      assert.equal(login.status, 200);
      assert.deepEqual(login.body.user, {
        id: registered.body.id,
        name: USER.name,
        email: USER.email,
      });
      assert.equal(jwt.verify(login.body.token, TEST_JWT_SECRET).sub, registered.body.id);

      const me = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${login.body.token}`);
      assert.equal(me.status, 200);
      assert.deepEqual(me.body, {
        user: { id: registered.body.id, name: USER.name, email: USER.email },
      });
    });
  });

  describe("requests that are rejected", () => {
    test("a duplicate email returns 409 and creates no extra workspace or membership", async () => {
      assert.equal((await register()).status, 201);

      const again = await register({ ...USER, name: "Someone Else" });
      assert.equal(again.status, 409);
      assert.deepEqual(again.body, { message: "Email already registered" });
      assert.deepEqual(await counts(), { users: 1, workspaces: 1, memberships: 1 });
    });

    test("invalid input returns 400 and creates nothing", async () => {
      const missing = await register({ name: "No Email", password: "password123" });
      assert.equal(missing.status, 400);

      const short = await register({ ...USER, password: "short" });
      assert.equal(short.status, 400);

      assert.deepEqual(await counts(), { users: 0, workspaces: 0, memberships: 0 });
    });
  });

  describe("when a step fails part-way (rollback)", () => {
    test("a failing membership step leaves no user, workspace or membership", async () => {
      const restore = breakMethod(Membership, "create");
      let res;
      try {
        res = await register();
      } finally {
        restore();
      }

      assert.equal(res.status, 500);
      assert.deepEqual(res.body, { message: "Server error" });
      assert.deepEqual(await counts(), { users: 0, workspaces: 0, memberships: 0 });
    });

    test("a failing workspace step leaves no user, workspace or membership", async () => {
      const restore = breakMethod(Workspace, "create");
      let res;
      try {
        res = await register();
      } finally {
        restore();
      }

      assert.equal(res.status, 500);
      assert.deepEqual(res.body, { message: "Server error" });
      assert.deepEqual(await counts(), { users: 0, workspaces: 0, memberships: 0 });
    });

    test("after a rolled-back failure the same email can register normally", async () => {
      const restore = breakMethod(Membership, "create");
      try {
        assert.equal((await register()).status, 500);
      } finally {
        restore();
      }

      const retry = await register();
      assert.equal(retry.status, 201);
      assert.deepEqual(await counts(), { users: 1, workspaces: 1, memberships: 1 });
    });

    test("a duplicate-key error from a later step is reported as a server error, not as a duplicate email", async () => {
      const failing = mock.method(Membership, "create", async () => {
        throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
      });
      const logged = mock.method(console, "error", () => {});
      let res;
      try {
        res = await register();
      } finally {
        failing.mock.restore();
        logged.mock.restore();
      }

      assert.equal(res.status, 500);
      assert.deepEqual(res.body, { message: "Server error" });
      assert.deepEqual(await counts(), { users: 0, workspaces: 0, memberships: 0 });
    });

    test("if the cleanup of the user also fails, the workspace and membership are still removed and it is logged", async () => {
      const failingStep = mock.method(Membership, "create", async () => {
        throw new Error("simulated membership failure");
      });
      const failingCleanup = mock.method(User, "deleteOne", async () => {
        throw new Error("simulated cleanup failure");
      });
      const logged = mock.method(console, "error", () => {});
      let res;
      try {
        res = await register();
      } finally {
        failingStep.mock.restore();
        failingCleanup.mock.restore();
      }
      const messages = logged.mock.calls.map((call) => call.arguments.join(" "));
      logged.mock.restore();

      // The response is still the normal server error
      assert.equal(res.status, 500);
      assert.deepEqual(res.body, { message: "Server error" });

      // Only the user is left (the migration step repairs this), and the failure is logged
      assert.deepEqual(await counts(), { users: 1, workspaces: 0, memberships: 0 });
      assert.ok(messages.some((message) => message.includes("Registration cleanup failed (user")));
    });

    test("a membership that was saved before the error is removed", async () => {
      const written = [];
      const failing = persistThenThrow(Membership, written);
      const logged = mock.method(console, "error", () => {});
      let res;
      try {
        res = await register();
      } finally {
        failing.mock.restore();
        logged.mock.restore();
      }

      assert.equal(res.status, 500);
      assert.deepEqual(res.body, { message: "Server error" });

      // The write really happened ...
      assert.equal(written.length, 1);
      // ... and the cleanup removed it, together with the workspace and the user
      assert.equal(await Membership.countDocuments({ _id: written[0] }), 0);
      assert.deepEqual(await counts(), { users: 0, workspaces: 0, memberships: 0 });
    });

    test("a workspace that was saved before the error is removed, and no membership cleanup runs", async () => {
      const written = [];
      const failing = persistThenThrow(Workspace, written);
      const events = [];
      const membershipDelete = spyOn(Membership, "deleteMany", "Membership.deleteMany", events);
      const logged = mock.method(console, "error", () => {});
      let res;
      try {
        res = await register();
      } finally {
        failing.mock.restore();
        membershipDelete.mock.restore();
        logged.mock.restore();
      }

      assert.equal(res.status, 500);
      assert.deepEqual(res.body, { message: "Server error" });
      assert.equal(written.length, 1);
      assert.equal(await Workspace.countDocuments({ _id: written[0] }), 0);
      assert.deepEqual(await counts(), { users: 0, workspaces: 0, memberships: 0 });

      // The workspace ID was never known, so no membership could exist yet
      assert.equal(events.length, 0);
    });

    test("cleanup removes only the failed attempt and leaves other users' records alone", async () => {
      // An existing user with a personal workspace, plus a team workspace with two members
      const first = await register();
      assert.equal(first.status, 201);
      const team = await Workspace.create({ name: "Team", createdBy: first.body.id });
      await Membership.create({ workspace: team._id, user: first.body.id, role: "owner" });
      await Membership.create({
        workspace: team._id,
        user: new mongoose.Types.ObjectId(),
        role: "member",
      });
      const beforeAttempt = await everything();
      assert.deepEqual(await counts(), { users: 1, workspaces: 2, memberships: 3 });

      // A second registration whose membership is saved and then fails
      const written = [];
      const failing = persistThenThrow(Membership, written);
      const logged = mock.method(console, "error", () => {});
      let res;
      try {
        res = await register({ ...USER, name: "Second", email: "second@example.com" });
      } finally {
        failing.mock.restore();
        logged.mock.restore();
      }

      assert.equal(res.status, 500);
      assert.equal(written.length, 1); // the failed attempt really saved a membership
      assert.equal(await everything(), beforeAttempt, "existing records must be untouched");
    });

    test("cleanup deletes with narrow filters, in reverse order", async () => {
      const ids = {};
      const events = [];

      // Remember the IDs the attempt creates, and make the last step fail
      const userCreate = User.create.bind(User);
      const workspaceCreate = Workspace.create.bind(Workspace);
      const recordUser = mock.method(User, "create", async (...args) => {
        const saved = await userCreate(...args);
        ids.user = saved._id;
        return saved;
      });
      const recordWorkspace = mock.method(Workspace, "create", async (...args) => {
        const saved = await workspaceCreate(...args);
        ids.workspace = saved._id;
        return saved;
      });
      const failing = mock.method(Membership, "create", async () => {
        throw new Error("simulated membership failure");
      });
      const spies = [
        spyOn(Membership, "deleteMany", "Membership.deleteMany", events),
        spyOn(Workspace, "deleteOne", "Workspace.deleteOne", events),
        spyOn(User, "deleteOne", "User.deleteOne", events),
      ];
      const logged = mock.method(console, "error", () => {});
      let res;
      try {
        res = await register();
      } finally {
        for (const mocked of [recordUser, recordWorkspace, failing, ...spies, logged]) {
          mocked.mock.restore();
        }
      }

      assert.equal(res.status, 500);
      assert.deepEqual(
        events.map((event) => event.name),
        ["Membership.deleteMany", "Workspace.deleteOne", "User.deleteOne"]
      );
      assert.deepEqual(events[0].filter, { workspace: String(ids.workspace) });
      assert.deepEqual(events[1].filter, { createdBy: String(ids.user), isPersonal: true });
      assert.deepEqual(events[2].filter, { _id: String(ids.user) });
    });

    test("if the membership cleanup fails, the workspace and user are still cleaned up and it is logged", async () => {
      const written = [];
      const failingStep = persistThenThrow(Membership, written);
      const failingCleanup = mock.method(Membership, "deleteMany", async () => {
        throw new Error("simulated membership cleanup failure");
      });
      const logged = mock.method(console, "error", () => {});
      let res;
      try {
        res = await register();
      } finally {
        failingStep.mock.restore();
        failingCleanup.mock.restore();
      }
      const messages = logged.mock.calls.map((call) => call.arguments.join(" "));
      logged.mock.restore();

      assert.equal(res.status, 500);
      assert.deepEqual(res.body, { message: "Server error" });

      // Only the saved membership is left (the migration reports this), and it is logged
      assert.equal(written.length, 1);
      assert.deepEqual(await counts(), { users: 0, workspaces: 0, memberships: 1 });
      assert.ok(messages.some((message) => message.includes("Registration cleanup failed (membership")));
    });

    test("if the workspace cleanup fails, the membership and user are still cleaned up and it is logged", async () => {
      const written = [];
      const failingStep = persistThenThrow(Membership, written);
      const failingCleanup = mock.method(Workspace, "deleteOne", async () => {
        throw new Error("simulated workspace cleanup failure");
      });
      const logged = mock.method(console, "error", () => {});
      let res;
      try {
        res = await register();
      } finally {
        failingStep.mock.restore();
        failingCleanup.mock.restore();
      }
      const messages = logged.mock.calls.map((call) => call.arguments.join(" "));
      logged.mock.restore();

      assert.equal(res.status, 500);
      assert.deepEqual(res.body, { message: "Server error" });

      // Only the workspace is left (the migration reports this), and it is logged
      assert.deepEqual(await counts(), { users: 0, workspaces: 1, memberships: 0 });
      assert.ok(messages.some((message) => message.includes("Registration cleanup failed (workspace")));
    });
  });
});