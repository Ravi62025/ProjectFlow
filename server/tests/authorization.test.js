import { describe, test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { startTestDb, clearTestDb, stopTestDb } from "./helpers.js";
import {
  createUser,
  createProject,
  createTask,
  send,
  snapshotDb,
} from "./apiHelpers.js";
import Project from "../src/models/Project.js";
import Task from "../src/models/Task.js";

// Authorization regression tests. Alice and Bob each own a project with tasks, and the
// tests check that neither can see or change the other's data through the real routes.
// (Another user deleting a project is already covered in projects.test.js.)

const OVERDUE = "2000-01-01"; // always in the past

let alice;
let bob;
let aliceProject; // Alice's project with two tasks
let aliceEmpty; // Alice's second project, without tasks
let bobProject; // Bob's project with three tasks
let aliceTodo; // Alice's To Do task, overdue
let aliceDone;
let bobTodo;
let bobProgress;
let bobDone;

const messageOf = (res) => res.body.message;

describe("authorization between users", () => {
  before(startTestDb);
  after(stopTestDb);

  beforeEach(async () => {
    await clearTestDb();

    alice = await createUser("alice");
    bob = await createUser("bob");

    aliceProject = await createProject(alice, "Alice Project");
    aliceEmpty = await createProject(alice, "Alice Empty");
    aliceTodo = await createTask(alice, aliceProject._id, {
      title: "Alice todo overdue",
      priority: "High",
      dueDate: OVERDUE,
    });
    aliceDone = await createTask(alice, aliceProject._id, {
      title: "Alice done",
      status: "Done",
    });

    bobProject = await createProject(bob, "Bob Project");
    bobTodo = await createTask(bob, bobProject._id, {
      title: "Bob todo overdue",
      dueDate: OVERDUE,
    });
    bobProgress = await createTask(bob, bobProject._id, {
      title: "Bob in progress",
      status: "In Progress",
    });
    bobDone = await createTask(bob, bobProject._id, { title: "Bob done", status: "Done" });
  });

  describe("another user's project and tasks (Alice acts on Bob's data)", () => {
    // Every attempt must be a 404 and must leave the whole database exactly as it was.
    // Paths and bodies are functions because the fixtures are created in beforeEach,
    // after these tests are registered.
    const attempts = [
      {
        label: "read the project",
        method: "get",
        path: () => `/api/projects/${bobProject._id}`,
        expected: "Project not found",
      },
      {
        label: "update the project",
        method: "put",
        path: () => `/api/projects/${bobProject._id}`,
        body: () => ({ name: "Hacked", description: "Hacked", status: "Completed" }),
        expected: "Project not found",
      },
      {
        label: "list its tasks",
        method: "get",
        path: () => `/api/projects/${bobProject._id}/tasks`,
        expected: "Project not found",
      },
      {
        label: "create a task in it",
        method: "post",
        path: () => `/api/projects/${bobProject._id}/tasks`,
        body: () => ({ title: "Injected task" }),
        expected: "Project not found",
      },
      {
        label: "update its task",
        method: "put",
        path: () => `/api/projects/${bobProject._id}/tasks/${bobTodo._id}`,
        body: () => ({ title: "Hacked", status: "Done" }),
        expected: "Project not found",
      },
      {
        label: "delete its task",
        method: "delete",
        path: () => `/api/projects/${bobProject._id}/tasks/${bobTodo._id}`,
        expected: "Project not found",
      },
      {
        label: "read its activity",
        method: "get",
        path: () => `/api/projects/${bobProject._id}/activity`,
        expected: "Project not found",
      },
      {
        label: "update Bob's task through her own project",
        method: "put",
        path: () => `/api/projects/${aliceProject._id}/tasks/${bobTodo._id}`,
        body: () => ({ title: "Hacked", status: "Done" }),
        expected: "Task not found",
      },
      {
        label: "delete Bob's task through her own project",
        method: "delete",
        path: () => `/api/projects/${aliceProject._id}/tasks/${bobTodo._id}`,
        expected: "Task not found",
      },
    ];

    for (const attempt of attempts) {
      test(`cannot ${attempt.label}`, async () => {
        const unchanged = await snapshotDb();

        const res = await send(attempt.method, attempt.path(), {
          user: alice,
          body: attempt.body?.(),
        });

        assert.equal(res.status, 404);
        assert.equal(messageOf(res), attempt.expected);
        assert.equal(await snapshotDb(), unchanged, "the attempt must not change any data");
      });
    }

    test("the answer is the same as for a project that does not exist", async () => {
      const missing = new mongoose.Types.ObjectId().toString();
      const foreign = await send("get", `/api/projects/${bobProject._id}`, { user: alice });
      const absent = await send("get", `/api/projects/${missing}`, { user: alice });
      assert.equal(foreign.status, absent.status);
      assert.deepEqual(foreign.body, absent.body);
    });

    test("the owner can still read and use the data that was targeted", async () => {
      const project = await send("get", `/api/projects/${bobProject._id}`, { user: bob });
      assert.equal(project.status, 200);
      assert.equal(project.body.project.name, "Bob Project");

      const tasks = await send("get", `/api/projects/${bobProject._id}/tasks`, { user: bob });
      assert.equal(tasks.status, 200);
      assert.equal(tasks.body.tasks.length, 3);

      const activity = await send("get", `/api/projects/${bobProject._id}/activity`, { user: bob });
      assert.equal(activity.status, 200);
      assert.ok(activity.body.activities.length > 0);
    });
  });

  describe("the user's own data (checks that the tests above are not passing by accident)", () => {
    test("a user can read and update their own project", async () => {
      const read = await send("get", `/api/projects/${aliceProject._id}`, { user: alice });
      assert.equal(read.status, 200);

      const update = await send("put", `/api/projects/${aliceProject._id}`, {
        user: alice,
        body: { status: "On Hold" },
      });
      assert.equal(update.status, 200);
      assert.equal(update.body.project.status, "On Hold");
    });

    test("a user can update their own task, and the database snapshot notices it", async () => {
      const before = await snapshotDb();
      const res = await send("put", `/api/projects/${aliceProject._id}/tasks/${aliceTodo._id}`, {
        user: alice,
        body: { status: "In Progress" },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.task.status, "In Progress");
      assert.notEqual(await snapshotDb(), before);
    });

    test("a user's project list contains only their own projects", async () => {
      const aliceList = await send("get", "/api/projects", { user: alice });
      assert.equal(aliceList.status, 200);
      assert.deepEqual(
        aliceList.body.projects.map((p) => p.name).sort(),
        ["Alice Empty", "Alice Project"]
      );

      const bobList = await send("get", "/api/projects", { user: bob });
      assert.deepEqual(bobList.body.projects.map((p) => p.name), ["Bob Project"]);
    });

    test("a user's task list for their own project contains only that project's tasks", async () => {
      const res = await send("get", `/api/projects/${aliceProject._id}/tasks`, { user: alice });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.tasks.map((t) => t.title).sort(), ["Alice done", "Alice todo overdue"]);
    });
  });

  describe("ownership comes from the token, never from the request body", () => {
    test("a new project is owned by the user even if the body names another owner", async () => {
      const res = await send("post", "/api/projects", {
        user: alice,
        body: { name: "Mine", owner: bob.id },
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.project.owner, alice.id);

      const stored = await Project.findById(res.body.project._id).lean();
      assert.equal(String(stored.owner), alice.id);
    });

    test("an update cannot hand a project over to another user", async () => {
      const res = await send("put", `/api/projects/${aliceProject._id}`, {
        user: alice,
        body: { name: "Renamed", owner: bob.id },
      });
      assert.equal(res.status, 200);

      const stored = await Project.findById(aliceProject._id).lean();
      assert.equal(String(stored.owner), alice.id);
      assert.equal(stored.name, "Renamed");
      const bobSees = await send("get", `/api/projects/${aliceProject._id}`, { user: bob });
      assert.equal(bobSees.status, 404);
    });

    test("a new task cannot name another project or owner in the body", async () => {
      const res = await send("post", `/api/projects/${aliceProject._id}/tasks`, {
        user: alice,
        body: { title: "Sneaky", project: bobProject._id, owner: bob.id },
      });
      assert.equal(res.status, 201);

      const stored = await Task.findById(res.body.task._id).lean();
      assert.equal(String(stored.project), aliceProject._id);
      assert.equal(String(stored.owner), alice.id);
      assert.equal(await Task.countDocuments({ title: "Sneaky", project: bobProject._id }), 0);
    });

    test("a task update cannot move the task to another project or owner", async () => {
      const res = await send("put", `/api/projects/${aliceProject._id}/tasks/${aliceTodo._id}`, {
        user: alice,
        body: { title: "Still mine", project: bobProject._id, owner: bob.id },
      });
      assert.equal(res.status, 200);

      const stored = await Task.findById(aliceTodo._id).lean();
      assert.equal(String(stored.project), aliceProject._id);
      assert.equal(String(stored.owner), alice.id);
      assert.equal(stored.title, "Still mine");
    });
  });

  describe("project activity", () => {
    test("a user sees only their own project's activity", async () => {
      const res = await send("get", `/api/projects/${aliceProject._id}/activity`, { user: alice });
      assert.equal(res.status, 200);
      // one project_created and two task_created entries
      assert.equal(res.body.activities.length, 3);
      assert.equal(JSON.stringify(res.body).includes("Bob"), false);
    });

    test("a larger limit does not reveal another user's activity", async () => {
      const res = await send("get", `/api/projects/${bobProject._id}/activity?limit=50`, {
        user: alice,
      });
      assert.equal(res.status, 404);
      assert.equal("activities" in res.body, false);
    });
  });

  describe("My Tasks (GET /api/tasks)", () => {
    test("returns only the authenticated user's tasks, with their project", async () => {
      const res = await send("get", "/api/tasks", { user: alice });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.tasks.map((t) => t.title).sort(), ["Alice done", "Alice todo overdue"]);
      for (const task of res.body.tasks) {
        assert.deepEqual(task.project, { _id: aliceProject._id, name: "Alice Project" });
        assert.equal(task.owner, alice.id);
      }
      assert.equal(JSON.stringify(res.body).includes("Bob"), false);
    });

    test("returns Bob's tasks to Bob and none of Alice's", async () => {
      const res = await send("get", "/api/tasks", { user: bob });
      assert.equal(res.status, 200);
      assert.deepEqual(
        res.body.tasks.map((t) => t.title).sort(),
        ["Bob done", "Bob in progress", "Bob todo overdue"]
      );
      assert.equal(JSON.stringify(res.body).includes("Alice"), false);
    });

    test("returns an empty list for a user with no projects", async () => {
      const carol = await createUser("carol");
      const res = await send("get", "/api/tasks", { user: carol });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { tasks: [] });
    });

    test("leaves out a task whose project no longer exists", async () => {
      await Task.create({
        title: "Orphan",
        project: new mongoose.Types.ObjectId(),
        owner: alice.id,
      });
      const res = await send("get", "/api/tasks", { user: alice });
      assert.equal(res.status, 200);
      assert.equal(res.body.tasks.length, 2);
      assert.equal(res.body.tasks.some((t) => t.title === "Orphan"), false);
    });
  });

  describe("dashboard statistics (GET /api/dashboard/stats)", () => {
    test("counts only the authenticated user's tasks and projects", async () => {
      const res = await send("get", "/api/dashboard/stats", { user: alice });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.taskStats, {
        totalTasks: 2,
        todoTasks: 1,
        inProgressTasks: 0,
        completedTasks: 1,
        activeTasks: 1,
        overdueTasks: 1,
        overallProgress: 50,
      });

      const ids = res.body.projectProgress.map((p) => p.projectId).sort();
      assert.deepEqual(ids, [aliceProject._id, aliceEmpty._id].sort());
      assert.equal(JSON.stringify(res.body).includes("Bob"), false);
    });

    test("gives Bob his own numbers, unaffected by Alice's data", async () => {
      const res = await send("get", "/api/dashboard/stats", { user: bob });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.taskStats, {
        totalTasks: 3,
        todoTasks: 1,
        inProgressTasks: 1,
        completedTasks: 1,
        activeTasks: 2,
        overdueTasks: 1,
        overallProgress: 33,
      });
      assert.deepEqual(
        res.body.projectProgress.map((p) => p.projectId),
        [bobProject._id]
      );
    });

    test("returns zeros for a user with no projects", async () => {
      const carol = await createUser("carol");
      const res = await send("get", "/api/dashboard/stats", { user: carol });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.taskStats, {
        totalTasks: 0,
        todoTasks: 0,
        inProgressTasks: 0,
        completedTasks: 0,
        activeTasks: 0,
        overdueTasks: 0,
        overallProgress: 0,
      });
      assert.deepEqual(res.body.projectProgress, []);
    });

    test("does not count a task whose project no longer exists", async () => {
      await Task.create({
        title: "Orphan",
        project: new mongoose.Types.ObjectId(),
        owner: alice.id,
        dueDate: new Date("2000-01-01T00:00:00.000Z"),
      });
      const res = await send("get", "/api/dashboard/stats", { user: alice });
      assert.equal(res.body.taskStats.totalTasks, 2);
      assert.equal(res.body.taskStats.overdueTasks, 1);
    });
  });

  describe("requests without a token", () => {
    // Every protected endpoint must answer 401 and must not change any data.
    const protectedRequests = [
      { label: "GET /api/projects", method: "get", path: () => "/api/projects" },
      {
        label: "POST /api/projects",
        method: "post",
        path: () => "/api/projects",
        body: () => ({ name: "Anonymous" }),
      },
      { label: "GET /api/projects/:id", method: "get", path: () => `/api/projects/${aliceProject._id}` },
      {
        label: "PUT /api/projects/:id",
        method: "put",
        path: () => `/api/projects/${aliceProject._id}`,
        body: () => ({ name: "Hacked" }),
      },
      {
        label: "DELETE /api/projects/:id",
        method: "delete",
        path: () => `/api/projects/${aliceProject._id}`,
      },
      {
        label: "GET /api/projects/:id/tasks",
        method: "get",
        path: () => `/api/projects/${aliceProject._id}/tasks`,
      },
      {
        label: "POST /api/projects/:id/tasks",
        method: "post",
        path: () => `/api/projects/${aliceProject._id}/tasks`,
        body: () => ({ title: "Anonymous" }),
      },
      {
        label: "PUT /api/projects/:id/tasks/:taskId",
        method: "put",
        path: () => `/api/projects/${aliceProject._id}/tasks/${aliceTodo._id}`,
        body: () => ({ status: "Done" }),
      },
      {
        label: "DELETE /api/projects/:id/tasks/:taskId",
        method: "delete",
        path: () => `/api/projects/${aliceProject._id}/tasks/${aliceTodo._id}`,
      },
      {
        label: "GET /api/projects/:id/activity",
        method: "get",
        path: () => `/api/projects/${aliceProject._id}/activity`,
      },
      { label: "GET /api/tasks", method: "get", path: () => "/api/tasks" },
      { label: "GET /api/dashboard/stats", method: "get", path: () => "/api/dashboard/stats" },
    ];

    for (const request of protectedRequests) {
      test(`${request.label} returns 401`, async () => {
        const unchanged = await snapshotDb();

        const res = await send(request.method, request.path(), { body: request.body?.() });

        assert.equal(res.status, 401);
        assert.deepEqual(res.body, { message: "Not authorized, token missing" });
        assert.equal(await snapshotDb(), unchanged, "the request must not change any data");
      });
    }

    test("an invalid token is rejected on a data endpoint", async () => {
      const res = await send("get", "/api/tasks", { user: { token: "not-a-real-token" } });
      assert.equal(res.status, 401);
      assert.deepEqual(res.body, { message: "Not authorized, token invalid" });
    });
  });
});