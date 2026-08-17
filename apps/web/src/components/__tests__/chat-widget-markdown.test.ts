/**
 * XSS del renderer de markdown del chat — OWASP A05:2025 (Injection).
 *
 * `renderMarkdown` alimenta un `dangerouslySetInnerHTML`. El contenido lo
 * produce el modelo, que puede estar citando chunks de la BD (RAG) — es texto
 * NO confiable. Estos tests fijan que ningún payload conocido produzca markup
 * ejecutable y que los enlaces sigan funcionando.
 */
import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../chat-widget";

const XSS_PAYLOADS = [
  '<script>alert(1)</script>',
  '<img src=x onerror="alert(1)">',
  '<svg/onload=alert(1)>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '"><script>alert(1)</script>',
  "'><img src=x onerror=alert(1)>",
  '<a href="javascript:alert(1)">click</a>',
  '<div style="background:url(javascript:alert(1))">x</div>',
  '<body onload=alert(1)>',
  '[click](javascript:alert(1))',
  '[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
  '**bold<script>alert(1)</script>**',
  '`<script>alert(1)</script>`',
  '- <script>alert(1)</script>',
];

/**
 * Aserción sobre el DOM resultante, no sobre el string: lo que importa es qué
 * elementos y atributos existen tras insertar el HTML, no si el texto escapado
 * contiene la palabra "onerror".
 */
function parse(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

function expectInert(html: string) {
  const root = parse(html);
  expect(root.querySelector("script, img, svg, iframe, object, embed, style")).toBeNull();
  for (const el of Array.from(root.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      expect(attr.name.toLowerCase().startsWith("on")).toBe(false);
      if (attr.name.toLowerCase() === "href") {
        expect(attr.value.trim().toLowerCase()).not.toMatch(/^(javascript|data|vbscript):/);
      }
    }
  }
}

describe("renderMarkdown — XSS", () => {
  it.each(XSS_PAYLOADS)("neutraliza %s", (payload) => {
    expectInert(renderMarkdown(payload));
  });

  it("no deja atributos rompibles con comillas", () => {
    const html = renderMarkdown('[x](/ruta" onmouseover="alert(1))');
    expectInert(html);
    // El texto queda dentro del href escapado, no como atributo suelto.
    const a = parse(html).querySelector("a");
    expect(a?.getAttributeNames()).not.toContain("onmouseover");
  });

  it("no linkifica URLs protocol-relative (navegan fuera del dominio)", () => {
    const html = renderMarkdown("[externo](//evil.example)");
    expect(html).not.toContain('href="//evil.example"');
  });
});

describe("renderMarkdown — funcionalidad preservada", () => {
  it("renderiza negritas, cursivas y código", () => {
    expect(renderMarkdown("**hola**")).toContain("<strong>hola</strong>");
    expect(renderMarkdown("*hola*")).toContain("<em>hola</em>");
    expect(renderMarkdown("`code`")).toContain("<code");
  });

  it("renderiza enlaces internos sin target y externos con rel seguro", () => {
    const interno = renderMarkdown("[Triage](/triage)");
    expect(interno).toContain('href="/triage"');
    expect(interno).not.toContain("target=");

    const externo = renderMarkdown("[MINSAL](https://www.salud.gob.sv)");
    expect(externo).toContain('href="https://www.salud.gob.sv"');
    expect(externo).toContain('rel="noopener noreferrer"');
  });

  it("renderiza listas ordenadas y con viñetas", () => {
    expect(renderMarkdown("1. uno\n2. dos")).toContain("<ol");
    expect(renderMarkdown("- uno\n- dos")).toContain("<ul");
  });

  it("escapa el texto plano sin alterarlo semánticamente", () => {
    expect(renderMarkdown("5 < 10 & 10 > 5")).toBe("5 &lt; 10 &amp; 10 &gt; 5");
  });
});
