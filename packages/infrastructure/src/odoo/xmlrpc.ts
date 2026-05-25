/**
 * Cliente XML-RPC mínimo para Odoo.
 *
 * Odoo expone 2 endpoints XML-RPC:
 *   - /xmlrpc/2/common — autenticación (authenticate, version)
 *   - /xmlrpc/2/object — operaciones CRUD (execute_kw)
 *
 * Implementación zero-dependency con fetch + serialización XML manual. No
 * cubre el spec completo de XML-RPC; soporta los tipos que Odoo realmente usa
 * (string, int, bool, double, array, struct, null).
 */

// ─── Serialización XML ──────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function serializeValue(v: unknown): string {
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
    const members = Object.entries(v as Record<string, unknown>)
      .map(
        ([k, val]) =>
          `<member><name>${escapeXml(k)}</name>${serializeValue(val)}</member>`,
      )
      .join("");
    return `<value><struct>${members}</struct></value>`;
  }
  throw new Error(`XML-RPC: tipo no soportado ${typeof v}`);
}

function buildMethodCall(method: string, params: unknown[]): string {
  const xmlParams = params
    .map((p) => `<param>${serializeValue(p)}</param>`)
    .join("");
  return `<?xml version="1.0"?><methodCall><methodName>${escapeXml(
    method,
  )}</methodName><params>${xmlParams}</params></methodCall>`;
}

// ─── Parseo XML ─────────────────────────────────────────────────────────────
// Parser muy simple basado en regex — Odoo retorna XML-RPC bien formado.
// Para producción se podría usar `fast-xml-parser` si la complejidad crece.

interface XmlNode {
  tag: string;
  children: XmlNode[];
  text: string;
}

function parseXml(xml: string): XmlNode {
  let pos = 0;
  // Saltar declaración XML
  if (xml.startsWith("<?xml")) {
    pos = xml.indexOf("?>") + 2;
  }
  function parseNode(): XmlNode {
    // Buscar siguiente <tag>
    while (pos < xml.length && xml[pos] !== "<") pos++;
    if (pos >= xml.length) throw new Error("XML parse: EOF inesperado");
    pos++; // skip <
    if (xml[pos] === "/") {
      // </closing>
      pos++;
      while (pos < xml.length && xml[pos] !== ">") pos++;
      pos++;
      return { tag: "__close", children: [], text: "" };
    }
    let tagEnd = pos;
    while (tagEnd < xml.length && xml[tagEnd] !== ">" && xml[tagEnd] !== " " && xml[tagEnd] !== "/") tagEnd++;
    const tag = xml.slice(pos, tagEnd);
    pos = tagEnd;
    // Skip atributos (Odoo no usa)
    while (pos < xml.length && xml[pos] !== ">" && xml[pos] !== "/") pos++;
    // Self-closing <nil/>
    if (xml[pos] === "/") {
      pos += 2; // skip />
      return { tag, children: [], text: "" };
    }
    pos++; // skip >
    // Leer texto + hijos
    const node: XmlNode = { tag, children: [], text: "" };
    let text = "";
    while (pos < xml.length) {
      while (pos < xml.length && xml[pos] !== "<") {
        text += xml[pos];
        pos++;
      }
      if (pos >= xml.length) break;
      // Peek si es cierre
      if (xml[pos + 1] === "/") {
        // Closing tag
        pos++;
        while (pos < xml.length && xml[pos] !== ">") pos++;
        pos++;
        break;
      }
      // Hijo
      const child = parseNode();
      node.children.push(child);
    }
    node.text = text.trim().replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    return node;
  }
  return parseNode();
}

function parseValue(node: XmlNode): unknown {
  // <value> wraps the type tag
  const inner = node.children[0];
  if (!inner) return node.text;
  switch (inner.tag) {
    case "nil":
      return null;
    case "boolean":
      return inner.text === "1" || inner.text === "true";
    case "int":
    case "i4":
      return parseInt(inner.text, 10);
    case "double":
      return parseFloat(inner.text);
    case "string":
      return inner.text;
    case "dateTime.iso8601":
      return inner.text;
    case "array": {
      const data = inner.children.find((c) => c.tag === "data");
      if (!data) return [];
      return data.children.filter((c) => c.tag === "value").map(parseValue);
    }
    case "struct": {
      const result: Record<string, unknown> = {};
      for (const member of inner.children.filter((c) => c.tag === "member")) {
        const nameNode = member.children.find((c) => c.tag === "name");
        const valueNode = member.children.find((c) => c.tag === "value");
        if (nameNode && valueNode) result[nameNode.text] = parseValue(valueNode);
      }
      return result;
    }
    default:
      return inner.text;
  }
}

function parseResponse(xml: string): unknown {
  const root = parseXml(xml);
  if (root.tag !== "methodResponse") throw new Error("XML-RPC: respuesta sin methodResponse");
  const params = root.children.find((c) => c.tag === "params");
  const fault = root.children.find((c) => c.tag === "fault");
  if (fault) {
    const val = parseValue(fault.children[0]!) as Record<string, unknown>;
    throw new Error(`XML-RPC fault: ${val?.faultString ?? "unknown"} (code ${val?.faultCode ?? "?"})`);
  }
  if (!params) throw new Error("XML-RPC: respuesta sin params");
  const param = params.children.find((c) => c.tag === "param");
  if (!param) return null;
  const value = param.children.find((c) => c.tag === "value");
  if (!value) return null;
  return parseValue(value);
}

// ─── Cliente público ────────────────────────────────────────────────────────

export async function xmlrpcCall(
  endpoint: string,
  method: string,
  params: unknown[],
): Promise<unknown> {
  const body = buildMethodCall(method, params);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body,
  });
  if (!res.ok) {
    throw new Error(`XML-RPC HTTP ${res.status} en ${endpoint}`);
  }
  const text = await res.text();
  return parseResponse(text);
}
