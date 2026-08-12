#!/usr/bin/env node
/**
 * scripts/odoo-users-no-clinical.mjs
 *
 * Cuenta usuarios INTERNOS de Odoo (res.users.share = false, active = true)
 * que NO sean médico, enfermero ni atención al cliente. Imprime el desglose
 * por job_id (puesto) y department_id (departamento) para verificar nombres.
 *
 * Autocontenido — implementa XML-RPC en línea (zero-dep, requiere Node ≥ 18
 * para fetch global).
 *
 * Uso (desde raíz del repo HIS):
 *   node --env-file=apps/web/.env.local scripts/odoo-users-no-clinical.mjs
 *
 * Para ver el detalle de cada usuario no clínico:
 *   VERBOSE=1 node --env-file=apps/web/.env.local scripts/odoo-users-no-clinical.mjs
 *
 * Env vars requeridas: ODOO_URL, ODOO_DB, ODOO_USER, ODOO_PASSWORD.
 */

// ═════════════════════════════════════════════════════════════════════════════
// Configuración
// ═════════════════════════════════════════════════════════════════════════════

const KEYWORDS_EXCLUIR = [
  "medic",        // médico, médica, médic@s
  "doctor",
  "enfermer",     // enfermero, enfermera, enfermería
  "nurse",
  "atencion al cliente",
  "atención al cliente",
  "customer service",
  "call center",
];

function esExcluido(nombre) {
  if (!nombre) return false;
  const lower = String(nombre).toLowerCase();
  return KEYWORDS_EXCLUIR.some((k) => lower.includes(k));
}

// ═════════════════════════════════════════════════════════════════════════════
// Cliente XML-RPC inline
// ═════════════════════════════════════════════════════════════════════════════

function escapeXml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function serializeValue(v) {
  if (v === null || v === undefined) return "<value><nil/></value>";
  if (typeof v === "boolean") return `<value><boolean>${v ? 1 : 0}</boolean></value>`;
  if (typeof v === "number") {
    return Number.isInteger(v)
      ? `<value><int>${v}</int></value>`
      : `<value><double>${v}</double></value>`;
  }
  if (typeof v === "string") return `<value><string>${escapeXml(v)}</string></value>`;
  if (Array.isArray(v)) {
    return `<value><array><data>${v.map(serializeValue).join("")}</data></array></value>`;
  }
  if (typeof v === "object") {
    const members = Object.entries(v)
      .map(([k, val]) => `<member><name>${escapeXml(k)}</name>${serializeValue(val)}</member>`)
      .join("");
    return `<value><struct>${members}</struct></value>`;
  }
  throw new Error(`XML-RPC: tipo no soportado ${typeof v}`);
}

function buildMethodCall(method, params) {
  const xmlParams = params.map((p) => `<param>${serializeValue(p)}</param>`).join("");
  return `<?xml version="1.0"?><methodCall><methodName>${escapeXml(method)}</methodName><params>${xmlParams}</params></methodCall>`;
}

function parseXml(xml) {
  let pos = 0;
  if (xml.startsWith("<?xml")) pos = xml.indexOf("?>") + 2;
  function parseNode() {
    while (pos < xml.length && xml[pos] !== "<") pos++;
    if (pos >= xml.length) throw new Error("XML parse: EOF");
    pos++;
    if (xml[pos] === "/") {
      pos++;
      while (pos < xml.length && xml[pos] !== ">") pos++;
      pos++;
      return { tag: "__close", children: [], text: "" };
    }
    let tagEnd = pos;
    while (tagEnd < xml.length && xml[tagEnd] !== ">" && xml[tagEnd] !== " " && xml[tagEnd] !== "/") tagEnd++;
    const tag = xml.slice(pos, tagEnd);
    pos = tagEnd;
    while (pos < xml.length && xml[pos] !== ">" && xml[pos] !== "/") pos++;
    if (xml[pos] === "/") { pos += 2; return { tag, children: [], text: "" }; }
    pos++;
    const node = { tag, children: [], text: "" };
    let text = "";
    while (pos < xml.length) {
      while (pos < xml.length && xml[pos] !== "<") { text += xml[pos]; pos++; }
      if (pos >= xml.length) break;
      if (xml[pos + 1] === "/") {
        pos++;
        while (pos < xml.length && xml[pos] !== ">") pos++;
        pos++;
        break;
      }
      node.children.push(parseNode());
    }
    node.text = text.trim().replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    return node;
  }
  return parseNode();
}

function parseValue(node) {
  const inner = node.children[0];
  if (!inner) return node.text;
  switch (inner.tag) {
    case "nil": return null;
    case "boolean": return inner.text === "1" || inner.text === "true";
    case "int": case "i4": return parseInt(inner.text, 10);
    case "double": return parseFloat(inner.text);
    case "string": return inner.text;
    case "dateTime.iso8601": return inner.text;
    case "array": {
      const data = inner.children.find((c) => c.tag === "data");
      return data ? data.children.filter((c) => c.tag === "value").map(parseValue) : [];
    }
    case "struct": {
      const result = {};
      for (const m of inner.children.filter((c) => c.tag === "member")) {
        const nm = m.children.find((c) => c.tag === "name");
        const vl = m.children.find((c) => c.tag === "value");
        if (nm && vl) result[nm.text] = parseValue(vl);
      }
      return result;
    }
    default: return inner.text;
  }
}

function parseResponse(xml) {
  const root = parseXml(xml);
  if (root.tag !== "methodResponse") throw new Error("XML-RPC: respuesta sin methodResponse");
  const fault = root.children.find((c) => c.tag === "fault");
  if (fault) {
    const val = parseValue(fault.children[0]);
    throw new Error(`XML-RPC fault: ${val?.faultString ?? "unknown"} (code ${val?.faultCode ?? "?"})`);
  }
  const params = root.children.find((c) => c.tag === "params");
  const param = params?.children.find((c) => c.tag === "param");
  const value = param?.children.find((c) => c.tag === "value");
  return value ? parseValue(value) : null;
}

async function xmlrpcCall(endpoint, method, params) {
  const body = buildMethodCall(method, params);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body,
  });
  if (!res.ok) throw new Error(`XML-RPC HTTP ${res.status} en ${endpoint}`);
  return parseResponse(await res.text());
}

// ═════════════════════════════════════════════════════════════════════════════
// Main
// ═════════════════════════════════════════════════════════════════════════════

async function main() {
  const url = process.env.ODOO_URL?.replace(/\/$/, "");
  const db = process.env.ODOO_DB;
  const user = process.env.ODOO_USER;
  const pass = process.env.ODOO_PASSWORD;
  if (!url || !db || !user || !pass) {
    throw new Error("Faltan env vars: ODOO_URL, ODOO_DB, ODOO_USER, ODOO_PASSWORD");
  }

  console.log(`Conectando a ${url} (db=${db})…`);
  const uid = await xmlrpcCall(`${url}/xmlrpc/2/common`, "authenticate", [db, user, pass, {}]);
  if (typeof uid !== "number" || uid <= 0) {
    throw new Error(`Authenticate falló: ${JSON.stringify(uid)}`);
  }
  console.log(`✓ Autenticado. UID=${uid}`);

  const exec = (model, method, args, kwargs = {}) =>
    xmlrpcCall(`${url}/xmlrpc/2/object`, "execute_kw", [db, uid, pass, model, method, args, kwargs]);

  // 1. Usuarios internos activos
  console.log("\n→ res.users (internos activos)…");
  const users = await exec(
    "res.users",
    "search_read",
    [[["share", "=", false], ["active", "=", true]]],
    { fields: ["id", "login", "name", "partner_id"], limit: 500, order: "login asc" },
  );
  console.log(`✓ ${users.length} usuarios internos activos`);

  // 2. hr.employee vinculados
  console.log("\n→ hr.employee asociados…");
  const userIds = users.map((u) => u.id);
  let employees = [];
  try {
    employees = await exec(
      "hr.employee",
      "search_read",
      [[["user_id", "in", userIds]]],
      { fields: ["id", "name", "user_id", "job_id", "department_id"], limit: 500 },
    );
    console.log(`✓ ${employees.length} empleados con user_id en el set`);
  } catch (e) {
    console.log(`⚠ No se pudo leer hr.employee (¿módulo HR instalado?): ${e.message}`);
    console.log("  Continúo solo con datos de res.users.");
  }

  const empByUser = new Map();
  for (const e of employees) {
    const uid = Array.isArray(e.user_id) ? e.user_id[0] : e.user_id;
    if (uid) empByUser.set(uid, e);
  }

  // 3. Desglose
  const porPuesto = new Map();
  const porDepto = new Map();
  let sinEmployee = 0, excluidos = 0;
  const noClinicos = [];

  for (const u of users) {
    const emp = empByUser.get(u.id);
    if (!emp) sinEmployee++;
    const jobName = emp && Array.isArray(emp.job_id) ? emp.job_id[1] : null;
    const deptName = emp && Array.isArray(emp.department_id) ? emp.department_id[1] : null;
    porPuesto.set(jobName ?? "(sin puesto)", (porPuesto.get(jobName ?? "(sin puesto)") ?? 0) + 1);
    porDepto.set(deptName ?? "(sin departamento)", (porDepto.get(deptName ?? "(sin departamento)") ?? 0) + 1);

    if (esExcluido(jobName) || esExcluido(deptName)) {
      excluidos++;
    } else {
      noClinicos.push({ login: u.login, name: u.name, job: jobName, dept: deptName });
    }
  }

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("DESGLOSE POR PUESTO (hr.employee.job_id)");
  console.log("══════════════════════════════════════════════════════════════");
  [...porPuesto.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) =>
    console.log(`  ${String(v).padStart(4)}  ${k}`),
  );

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("DESGLOSE POR DEPARTAMENTO (hr.employee.department_id)");
  console.log("══════════════════════════════════════════════════════════════");
  [...porDepto.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) =>
    console.log(`  ${String(v).padStart(4)}  ${k}`),
  );

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("RESULTADO");
  console.log("══════════════════════════════════════════════════════════════");
  console.log(`  Total usuarios internos activos:        ${users.length}`);
  console.log(`  Sin employee asociado:                  ${sinEmployee}`);
  console.log(`  Excluidos (médico/enfermero/at.cli):    ${excluidos}`);
  console.log(`  → NO médico/enfermero/at.cliente:       ${noClinicos.length}`);
  console.log(`\nKeywords (substring, case-insensitive): ${KEYWORDS_EXCLUIR.join(", ")}`);
  console.log("Si los puestos/departamentos no encajan, edita KEYWORDS_EXCLUIR y re-ejecuta.");

  if (process.env.VERBOSE === "1") {
    console.log("\n──── Detalle de los NO clínicos ────");
    noClinicos.forEach((u) =>
      console.log(`  ${u.login.padEnd(35)}  ${(u.job ?? "—").padEnd(30)}  ${u.dept ?? "—"}`),
    );
  }
}

main().catch((err) => {
  console.error("✗ Error:", err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
