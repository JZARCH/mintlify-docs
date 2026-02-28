import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const POSTMAN_PATH = "C:/Users/Jasmon/Downloads/Online Check Writer API V3.postman_collection.json";
const WEBHOOK_POSTMAN_PATH = "C:/Users/Jasmon/Downloads/New Collection.postman_collection (1).json";
const OUTPUT_ROOT = path.join(ROOT, "api-reference", "generated");

function slugify(text) {
  return (text || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "endpoint";
}

function toCamel(input) {
  const s = (input || "").replace(/[^a-zA-Z0-9]+/g, " ").trim();
  if (!s) return "id";
  const parts = s.split(/\s+/);
  return (
    parts[0].toLowerCase() +
    parts
      .slice(1)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
      .join("")
  );
}

function singularize(segment) {
  const s = (segment || "").toLowerCase();
  if (s.endsWith("ies")) return s.slice(0, -3) + "y";
  if (s.endsWith("ses")) return s.slice(0, -2);
  if (s.endsWith("s") && !s.endsWith("ss")) return s.slice(0, -1);
  return s;
}

function inferParamName(prevSeg) {
  const prev = (prevSeg || "").toLowerCase();
  if (!prev) return "id";
  if (prev.includes("routing")) return "routingNumber";
  if (prev.includes("reference")) return "referenceId";
  if (prev.includes("customer")) return "customerId";
  if (prev.includes("wallet")) return "walletId";
  if (prev.includes("bank-account")) return "bankAccountId";
  if (prev.includes("payee")) return "payeeId";
  if (prev.includes("check")) return "checkId";
  return `${toCamel(singularize(prev))}Id`;
}

function isLikelyDynamicSegment(seg) {
  if (!seg) return false;
  if (/^\d{6,}$/.test(seg)) return true;
  if (/^[a-f0-9]{8}-[a-f0-9-]{27,}$/i.test(seg)) return true;
  if (/^[A-Za-z0-9]{12,}$/.test(seg) && /\d/.test(seg) && /[A-Za-z]/.test(seg)) return true;
  return false;
}

function normalizePathSegment(seg, prevSeg) {
  const raw = String(seg || "").trim();
  if (!raw) return raw;

  const varMatch = raw.match(/^\{\{(.+)\}\}$/);
  if (varMatch) {
    return `{${varMatch[1]}}`;
  }

  const braceVar = raw.match(/^\{(.+)\}$/);
  if (braceVar) {
    return `{${braceVar[1]}}`;
  }

  if (isLikelyDynamicSegment(raw)) {
    return `{${inferParamName(prevSeg)}}`;
  }

  return raw;
}

function extractPathAndMethod(item) {
  const req = item.request || {};
  const method = (req.method || "GET").toUpperCase();
  const url = req.url || {};

  let rawPath = "/";
  if (Array.isArray(url.path) && url.path.length) {
    rawPath += url.path.map((p) => String(p).trim()).filter(Boolean).join("/");
  } else if (typeof url.raw === "string") {
    const raw = url.raw;
    const m = raw.match(/}}(.*)/);
    rawPath = m ? m[1] : raw;
    if (!rawPath.startsWith("/")) rawPath = "/" + rawPath;
  }

  // Remove query string from API path in frontmatter
  rawPath = rawPath.split("?")[0];

  const parts = rawPath
    .split("/")
    .filter(Boolean)
    .map((seg, idx, arr) => normalizePathSegment(seg, idx > 0 ? arr[idx - 1] : ""));

  let pathStr = "/" + parts.join("/");
  if (pathStr.length > 1 && pathStr.endsWith("/")) {
    pathStr = pathStr.slice(0, -1);
  }

  return { method, path: pathStr };
}

function extractExampleResponse(item) {
  const responses = item.response || [];
  if (!responses.length) return null;
  const body = (responses[0].body || "").trim();
  if (!body) return null;
  try {
    const parsed = JSON.parse(body);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return body;
  }
}

function extractQueryParams(item) {
  const req = item.request || {};
  const url = req.url || {};
  if (!Array.isArray(url.query)) return [];
  return url.query
    .filter((q) => q && q.key)
    .map((q) => ({
      name: String(q.key),
      description: typeof q.description === "string" ? q.description : "",
    }));
}

function flattenBodyFields(obj, prefix = "", out = []) {
  if (obj === null || obj === undefined) return out;
  if (Array.isArray(obj)) {
    if (obj.length === 0) return out;
    const first = obj[0];
    if (typeof first === "object" && first !== null) {
      flattenBodyFields(first, prefix ? `${prefix}[0]` : "[0]", out);
    } else {
      out.push({
        path: prefix || "items",
        type: `${typeof first}[]`,
      });
    }
    return out;
  }

  if (typeof obj !== "object") {
    out.push({
      path: prefix || "value",
      type: typeof obj,
    });
    return out;
  }

  Object.entries(obj).forEach(([k, v]) => {
    const next = prefix ? `${prefix}.${k}` : k;
    if (v === null) {
      out.push({ path: next, type: "string" });
      return;
    }
    if (Array.isArray(v)) {
      if (!v.length) {
        out.push({ path: next, type: "object[]" });
      } else if (typeof v[0] === "object" && v[0] !== null) {
        out.push({ path: next, type: "object[]" });
      } else {
        out.push({ path: next, type: `${typeof v[0]}[]` });
      }
      return;
    }
    if (typeof v === "object") {
      out.push({ path: next, type: "object" });
      flattenBodyFields(v, next, out);
      return;
    }
    out.push({ path: next, type: typeof v });
  });

  return out;
}

function normalizeFieldType(type) {
  if (type === "number" || type === "string" || type === "boolean" || type === "object") {
    return type;
  }
  if (type === "bigint") return "number";
  if (type === "undefined" || type === "function" || type === "symbol") return "string";
  if (typeof type === "string" && type.endsWith("[]")) {
    const base = type.slice(0, -2);
    const normalizedBase = ["number", "string", "boolean", "object"].includes(base) ? base : "string";
    return `${normalizedBase}[]`;
  }
  return "string";
}

function extractBodyFields(item) {
  const req = item.request || {};
  const body = req.body || {};
  if (body.mode !== "raw" || typeof body.raw !== "string") return [];
  const raw = body.raw.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const flat = flattenBodyFields(parsed);
    const dedup = new Map();
    flat.forEach((f) => {
      if (!dedup.has(f.path)) dedup.set(f.path, normalizeFieldType(f.type));
    });
    return Array.from(dedup.entries()).map(([path, type]) => ({ path, type }));
  } catch {
    return [];
  }
}

function safeParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractRequestUrlParts(item) {
  const req = item.request || {};
  const url = req.url || {};
  const host = Array.isArray(url.host) && url.host.length ? url.host.join(".") : "your-server.com";
  const pathParts = Array.isArray(url.path) ? url.path : [];
  const reqPath = "/" + pathParts.join("/");
  return { host, reqPath: reqPath === "/" ? "/webhooks/zilmoney" : reqPath };
}

function extractPathParamsFromApiPath(apiPath) {
  const matches = apiPath.match(/\{([^}]+)\}/g) || [];
  return matches.map((m) => m.slice(1, -1));
}

function writeEndpointPage(groupSegments, item, indexEntries) {
  const name = item.name || "Endpoint";
  const { method, path: apiPath } = extractPathAndMethod(item);
  const req = item.request || {};
  const description =
    typeof req.description === "string" ? req.description.trim() : "";
  const example = extractExampleResponse(item);
  const queryParams = extractQueryParams(item);
  let bodyFields = extractBodyFields(item);
  const pathParams = extractPathParamsFromApiPath(apiPath);
  const isWebhook = groupSegments.includes("Zil Money Webhook Integration");

  if (!bodyFields.length && example) {
    const parsedExample = safeParseJson(example);
    if (parsedExample && typeof parsedExample === "object") {
      const flat = flattenBodyFields(parsedExample);
      const dedup = new Map();
      flat.forEach((f) => {
        if (!dedup.has(f.path)) dedup.set(f.path, normalizeFieldType(f.type));
      });
      bodyFields = Array.from(dedup.entries()).map(([path, type]) => ({ path, type }));
    }
  }

  const groupSlugParts = groupSegments.map((seg) => slugify(seg)).filter(Boolean);
  const fileSlug = slugify(name);
  const relDir = groupSlugParts.length
    ? path.join(...groupSlugParts)
    : ".";
  const fullDir = path.join(OUTPUT_ROOT, relDir);
  fs.mkdirSync(fullDir, { recursive: true });
  const filePath = path.join(fullDir, `${fileSlug}.mdx`);

  const apiValue = `${method} ${apiPath}`;
  const title = name.replace(/'/g, "\\'");

  const lines = [];
  lines.push("---");
  lines.push(`title: '${title}'`);
  lines.push(`api: '${apiValue}'`);
  lines.push(`authMethod: '${isWebhook ? "none" : "bearer"}'`);
  if (isWebhook) lines.push("playground: 'none'");
  lines.push("---");
  lines.push("");
  if (description) {
    lines.push(description.replace(/<[^>]+>/g, "").slice(0, 5000));
    lines.push("");
  }

  if (isWebhook) {
    const reqHeaders = Array.isArray(req.header) ? req.header : [];
    const { host, reqPath } = extractRequestUrlParts(item);

    lines.push("## HEADERS");
    lines.push("");
    lines.push("| Header | Value |");
    lines.push("| --- | --- |");
    reqHeaders.forEach((h) => {
      const key = h?.key ? String(h.key) : "";
      if (!key) return;
      const value = h?.value ? String(h.value) : "";
      const desc = h?.description ? String(h.description) : "";
      const cell = value ? `${value}${desc ? `<br/>${desc}` : ""}` : (desc || "-");
      lines.push(`| ${key} | ${cell} |`);
    });
    lines.push("");

    lines.push("## Example Request");
    lines.push("");
    lines.push("```http");
    lines.push(`${method} ${reqPath} HTTP/1.1`);
    lines.push(`Host: ${host}`);
    reqHeaders.forEach((h) => {
      const key = h?.key ? String(h.key) : "";
      if (!key) return;
      const value = h?.value ? String(h.value) : "";
      lines.push(`${key}: ${value}`);
    });
    lines.push("```");
    lines.push("");

    if (example) {
      lines.push("## Example Response");
      lines.push("");
      lines.push("```json");
      lines.push(example);
      lines.push("```");
      lines.push("");
    }
  } else {
    if (pathParams.length) {
      lines.push("## Path parameters");
      lines.push("");
      pathParams.forEach((p) => {
        lines.push(`<ParamField path="${p}" type="string" required>`);
        lines.push(`  Path parameter \`${p}\`.`);
        lines.push("</ParamField>");
        lines.push("");
      });
    }

    if (queryParams.length) {
      lines.push("## Query parameters");
      lines.push("");
      queryParams.forEach((q) => {
        lines.push(`<ParamField query="${q.name}" type="string">`);
        lines.push(`  ${q.description || `Query parameter \`${q.name}\`.`}`);
        lines.push("</ParamField>");
        lines.push("");
      });
    }

    if (bodyFields.length) {
      lines.push("## Body parameters");
      lines.push("");
      bodyFields.forEach((f) => {
        lines.push(`<ParamField body="${f.path}" type="${f.type}">`);
        lines.push(`  Request body field \`${f.path}\`.`);
        lines.push("</ParamField>");
        lines.push("");
      });
    }

    lines.push("## Request");
    lines.push("");
    lines.push(`Endpoint: \`${apiValue}\``);
    lines.push("");
    lines.push("### Example");
    lines.push("");
    lines.push("```bash");
    lines.push(`curl --location "$BASE_URL${apiPath}" \\`);
    lines.push('  --header "Authorization: Bearer $AUTH_TOKEN" \\');
    lines.push('  --header "Accept: application/json"');
    lines.push("```");
    lines.push("");
    if (example) {
      lines.push("## Response example");
      lines.push("");
      lines.push("```json");
      lines.push(example);
      lines.push("```");
      lines.push("");
    }
  }

  fs.writeFileSync(filePath, lines.join("\n"), "utf8");

  const relDirPosix =
    relDir === "." ? "" : relDir.split(path.sep).join("/");
  const pagePath = `api-reference/generated/${
    relDirPosix ? relDirPosix + "/" : ""
  }${fileSlug}`;

  indexEntries.push({
    group: groupSegments.join(" / "),
    title: name,
    method,
    path: apiPath,
    page: pagePath,
  });
}

function walkItems(items, parentSegments, indexEntries) {
  (items || []).forEach((item) => {
    const name = item.name || "";
    if (Array.isArray(item.item) && item.item.length) {
      walkItems(item.item, [...parentSegments, name], indexEntries);
    } else if (item.request) {
      writeEndpointPage(parentSegments, item, indexEntries);
    }
  });
}

function writeIndexPage(indexEntries) {
  const indexPath = path.join(ROOT, "api-reference", "all-endpoints.mdx");
  const lines = [];
  lines.push("---");
  lines.push("title: 'All endpoints'");
  lines.push(
    "description: 'Index of all Online Check Writer API v3 endpoints generated from the Postman collection'"
  );
  lines.push("---");
  lines.push("");
  lines.push(
    "This page lists all endpoints that were generated from the Online Check Writer API v3 Postman collection."
  );
  lines.push("");
  lines.push("| Group | Method | Path | Page |");
  lines.push("| --- | --- | --- | --- |");

  indexEntries
    .sort((a, b) => {
      if (a.group === b.group) {
        if (a.path === b.path) return a.method.localeCompare(b.method);
        return a.path.localeCompare(b.path);
      }
      return a.group.localeCompare(b.group);
    })
    .forEach((e) => {
      const group = e.group || "Root";
      lines.push(
        `| ${group} | \`${e.method}\` | \`${e.path}\` | [${e.title}](/${e.page}) |`
      );
    });

  fs.writeFileSync(indexPath, lines.join("\n"), "utf8");
}

function writeFolderPages(indexEntries) {
  const foldersDir = path.join(ROOT, "api-reference", "folders");
  fs.mkdirSync(foldersDir, { recursive: true });

  const byFolder = new Map();
  indexEntries.forEach((e) => {
    const group = e.group || "";
    const first = group.split(" / ")[0] || "Other";
    if (!byFolder.has(first)) byFolder.set(first, []);
    byFolder.get(first).push(e);
  });

  Array.from(byFolder.entries()).forEach(([folderName, entries]) => {
    const slug = slugify(folderName);
    const filePath = path.join(foldersDir, `${slug}.mdx`);

    const lines = [];
    lines.push("---");
    lines.push(`title: '${folderName} API'`);
    lines.push(
      `description: 'Endpoints in the ${folderName} section of the Online Check Writer API v3'`
    );
    lines.push("---");
    lines.push("");
    lines.push(
      `This page lists all endpoints that belong to the **${folderName}** folder in the Postman collection.`
    );
    lines.push("");
    lines.push("| Method | Path | Endpoint |");
    lines.push("| --- | --- | --- |");

    entries
      .sort((a, b) => {
        if (a.path === b.path) return a.method.localeCompare(b.method);
        return a.path.localeCompare(b.path);
      })
      .forEach((e) => {
        lines.push(
          `| \`${e.method}\` | \`${e.path}\` | [${e.title}](/${e.page}) |`
        );
      });

    fs.writeFileSync(filePath, lines.join("\n"), "utf8");
  });
}

function writeNavJson(indexEntries) {
  const navPath = path.join(ROOT, "api-reference", "nav.generated.json");

  const byMain = new Map();

  indexEntries.forEach((e) => {
    if (!e.group) return;
    const parts = e.group.split(" / ");
    const main = parts[0] || "Other";
    const sub = parts[1] || null;

    if (!byMain.has(main)) {
      byMain.set(main, { main, pages: [], subs: new Map() });
    }
    const bucket = byMain.get(main);

    if (!sub) {
      bucket.pages.push(e.page);
    } else {
      if (!bucket.subs.has(sub)) {
        bucket.subs.set(sub, []);
      }
      bucket.subs.get(sub).push(e.page);
    }
  });

  const groups = Array.from(byMain.values()).map((bucket) => {
    const group = { group: bucket.main, pages: [] };

    bucket.pages.forEach((p) => group.pages.push(p));

    Array.from(bucket.subs.entries()).forEach(([subName, pages]) => {
      group.pages.push({
        group: subName,
        pages,
      });
    });

    return group;
  });

  fs.writeFileSync(
    navPath,
    JSON.stringify({ groups }, null, 2),
    "utf8"
  );
}

function main() {
  if (!fs.existsSync(POSTMAN_PATH)) {
    console.error(`Postman collection not found at ${POSTMAN_PATH}`);
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  const raw = fs.readFileSync(POSTMAN_PATH, "utf8");
  const data = JSON.parse(raw);

  const items = (data.item || []).filter((it) => (it?.name || "") !== "Zil Money Webhook Integration");
  const indexEntries = [];
  walkItems(items, [], indexEntries);

  if (fs.existsSync(WEBHOOK_POSTMAN_PATH)) {
    const webhookRaw = fs.readFileSync(WEBHOOK_POSTMAN_PATH, "utf8");
    const webhookData = JSON.parse(webhookRaw);
    const webhookItems = webhookData.item || [];
    walkItems(webhookItems, ["Zil Money Webhook Integration"], indexEntries);
  }

  writeFolderPages(indexEntries);
  writeIndexPage(indexEntries);
  writeNavJson(indexEntries);
  console.log(
    `Generated ${indexEntries.length} endpoint pages under ${OUTPUT_ROOT}`
  );
}

main();

