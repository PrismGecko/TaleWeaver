import test from "node:test";
import assert from "node:assert/strict";

import { buildBranchTree } from "../src/services/branchService.js";
import { createBranch, normalizeProject } from "../src/models/storyProject.js";

test("buildBranchTree nests children under parents", () => {
  const root = createBranch({ branch_id: "root", title: "Root" });
  const child = createBranch({
    branch_id: "child",
    parent_branch_id: "root",
  });

  const tree = buildBranchTree([root, child]);

  assert.equal(tree.length, 1);
  assert.equal(tree[0].branch.branch_id, "root");
  assert.equal(tree[0].children[0].branch.branch_id, "child");
});

test("buildBranchTree survives a self-parented branch", () => {
  const branch = createBranch({ branch_id: "loop" });
  branch.parent_branch_id = "loop";

  const tree = buildBranchTree([branch]);

  assert.equal(tree.length, 1);
  assert.equal(tree[0].branch.branch_id, "loop");
  assert.deepEqual(tree[0].children, []);
});

test("buildBranchTree treats cycle members as roots", () => {
  const alpha = createBranch({ branch_id: "alpha" });
  const beta = createBranch({ branch_id: "beta" });
  alpha.parent_branch_id = "beta";
  beta.parent_branch_id = "alpha";
  const outsider = createBranch({
    branch_id: "outsider",
    parent_branch_id: "alpha",
  });

  const tree = buildBranchTree([alpha, beta, outsider]);

  const rootIds = tree.map((node) => node.branch.branch_id).sort();
  assert.deepEqual(rootIds, ["alpha", "beta"]);
  const alphaNode = tree.find((node) => node.branch.branch_id === "alpha");
  assert.deepEqual(
    alphaNode.children.map((node) => node.branch.branch_id),
    ["outsider"],
  );
});

test("normalizeProject drops duplicate branch ids", () => {
  const project = normalizeProject({
    branches: [
      { branch_id: "twin", title: "First" },
      { branch_id: "twin", title: "Second" },
    ],
  });

  assert.equal(project.branches.length, 1);
  assert.equal(project.branches[0].title, "First");
});

test("normalizeProject clears self and dangling parent references", () => {
  const project = normalizeProject({
    branches: [
      { branch_id: "a", parent_branch_id: "a" },
      { branch_id: "b", parent_branch_id: "missing" },
      { branch_id: "c", parent_branch_id: "a" },
    ],
  });

  const byId = new Map(
    project.branches.map((branch) => [branch.branch_id, branch]),
  );
  assert.equal(byId.get("a").parent_branch_id, null);
  assert.equal(byId.get("b").parent_branch_id, null);
  assert.equal(byId.get("c").parent_branch_id, "a");
});
