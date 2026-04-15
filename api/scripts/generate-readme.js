#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const swaggerPath = path.join(ROOT, "api-docs", "swagger.json");
const skillsPath = path.join(ROOT, "skills.md");
const readmePath = path.join(ROOT, "README.md");

function loadSwagger() {
  const raw = fs.readFileSync(swaggerPath, "utf8");
  return JSON.parse(raw);
}

function loadSkills() {
  try {
    return fs.readFileSync(skillsPath, "utf8");
  } catch (err) {
    return "";
  }
}

function buildEndpointsSection(swaggerSpec) {
  const paths = swaggerSpec.paths || {};
  const methodsOrder = ["get", "post", "put", "delete", "patch", "options", "head"];

  const lines = [];
  lines.push("## Endpoints", "");
  lines.push("| Method | Path | Summary | Auth |");
  lines.push("| ------ | ---- | ------- | ---- |");

  const sortedPaths = Object.keys(paths).sort();

  for (const p of sortedPaths) {
    const item = paths[p] || {};
    for (const method of methodsOrder) {
      if (!item[method]) continue;
      const op = item[method];
      const summary = (op.summary || "").replace(/\|/g, "\\|");
      const hasAuth = op.security && op.security.length > 0;
      const auth = hasAuth ? "Bearer" : "none";
      lines.push(`| ${method.toUpperCase()} | \`${p}\` | ${summary} | ${auth} |`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

function main() {
  const swagger = loadSwagger();
  const skills = loadSkills();
  const info = swagger.info || {};

  const out = [];

  // Title and description
  out.push(`# ${info.title || "IDClawserver API"}`);
  out.push("");

  if (info.description) {
    out.push(info.description.trim());
    out.push("");
  }

  if (info.version) {
    out.push(`**Version:** ${info.version}`);
    out.push("");
  }

  // Skills section (raw markdown)
  if (skills && skills.trim().length > 0) {
    out.push("## Skills");
    out.push("");
    out.push(skills.trim());
    out.push("");
  }

  // Endpoints table from swagger
  out.push(buildEndpointsSection(swagger));

  const finalContent = out.join("\n") + "\n";
  fs.writeFileSync(readmePath, finalContent, "utf8");
  console.log("README.md regenerated from swagger.json and skills.md");
}

main();
