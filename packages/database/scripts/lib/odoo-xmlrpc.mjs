/**
 * Cliente XML-RPC de Odoo para scripts de BD (zero-dep, requiere Node >= 18).
 *
 * Extraído del patrón ya usado en scripts/odoo-users-no-clinical.mjs y en
 * packages/infrastructure/src/odoo/ (versión TS del runtime de la app), para
 * que los scripts de sincronización de tarifario no lo vuelvan a copiar.
 *
 * Credenciales por env vars: ODOO_URL, ODOO_DB, ODOO_USER, ODOO_PASSWORD.
 * SOLO LECTURA — la escritura a Odoo está prohibida por política del proyecto.
 */

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

export async function connect() {
  const url = process.env.ODOO_URL?.replace(/\/$/, "");
  const db = process.env.ODOO_DB;
  const user = process.env.ODOO_USER;
  const pass = process.env.ODOO_PASSWORD;
  if (!url || !db || !user || !pass) throw new Error("Faltan env vars ODOO_*");
  const uid = await xmlrpcCall(`${url}/xmlrpc/2/common`, "authenticate", [db, user, pass, {}]);
  if (typeof uid !== "number" || uid <= 0) throw new Error(`authenticate falló: ${JSON.stringify(uid)}`);
  const exec = (model, method, args, kwargs = {}) =>
    xmlrpcCall(`${url}/xmlrpc/2/object`, "execute_kw", [db, uid, pass, model, method, args, kwargs]);
  return { uid, exec, url, db };
}
