const INPUT_PREFIX = "INPUT_";

function inputKey(name) {
  return `${INPUT_PREFIX}${name.replace(/ /g, "_").replace(/-/g, "_").toUpperCase()}`;
}

function getInput(name, options = {}) {
  const value = process.env[inputKey(name)] ?? "";
  const trimmed = value.trim();
  const fallbackValue = Array.isArray(options.fallbackEnv)
    ? options.fallbackEnv
        .map((envName) => process.env[envName] ?? "")
        .find((candidate) => String(candidate).trim() !== "")
    : "";
  const resolved = trimmed || String(fallbackValue).trim();

  if (!resolved && options.required) {
    throw new Error(`Missing required input: ${name}`);
  }

  if (!resolved && options.defaultValue !== undefined) {
    return options.defaultValue;
  }

  return resolved;
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

function parseList(value) {
  return String(value ?? "")
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function renderTemplate(template, context) {
  return String(template).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const value = context[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

function escapeDescriptionBlock(value) {
  return String(value ?? "").trim();
}

function sourceMarker(item) {
  return `Source: ${item.url}`;
}

function buildTaskContent(item, template) {
  return renderTemplate(template, item).trim();
}

function buildTaskDescription(item, template) {
  const base = escapeDescriptionBlock(renderTemplate(template, item));
  return [base, sourceMarker(item)].filter(Boolean).join("\n\n");
}

function normalizeGitHubItem(raw, repo) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Cannot normalize an empty GitHub item.");
  }

  const isPullRequest = Boolean(raw.pull_request) || String(raw.html_url || "").includes("/pull/");
  const type = isPullRequest ? "pull-request" : "issue";

  return {
    repo,
    type,
    kind: isPullRequest ? "PR" : "Issue",
    number: raw.number,
    title: raw.title ?? "",
    url: raw.html_url ?? "",
    body: raw.body ?? "",
    desc: raw.body ?? "",
    state: raw.state ?? "",
    author: raw.user?.login ?? "",
    assignees: Array.isArray(raw.assignees) ? raw.assignees.map((assignee) => assignee.login).join(", ") : ""
  };
}

function parsePriority(value, defaultValue = "P4") {
  const normalized = String(value ?? defaultValue).trim().toUpperCase() || defaultValue;
  const mapping = {
    P1: 4,
    P2: 3,
    P3: 2,
    P4: 1
  };

  if (!(normalized in mapping)) {
    throw new Error(`Invalid priority "${value}". Use P1, P2, P3, or P4.`);
  }

  return mapping[normalized];
}

function buildReminderDateTime(now = new Date()) {
  const reminderAt = new Date(now.getTime() + 60_000);
  return reminderAt.toISOString().replace(/\.\d{3}Z$/, ".000000Z");
}

function taskMatchesItem(task, item) {
  const marker = sourceMarker(item);
  const description = String(task?.description ?? "");
  return description.includes(marker);
}

function sortItems(items) {
  return [...items].sort((left, right) => Number(left.number) - Number(right.number));
}

module.exports = {
  buildTaskContent,
  buildTaskDescription,
  buildReminderDateTime,
  getInput,
  normalizeGitHubItem,
  parsePriority,
  parseBoolean,
  parseList,
  renderTemplate,
  sortItems,
  sourceMarker,
  taskMatchesItem
};
