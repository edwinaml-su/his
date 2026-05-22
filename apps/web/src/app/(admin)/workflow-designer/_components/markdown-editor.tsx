"use client";

/**
 * MarkdownEditor — Editor WYSIWYG basado en TipTap que persiste markdown.
 *
 * Fase 3 del workflow-designer enhancement.
 *
 * Renderiza:
 *   - Toolbar con: heading 2/3, bold, italic, lista, lista numerada, link, code, blockquote.
 *   - Área editable contenteditable con estilo Tailwind/Prose.
 *   - Counter de caracteres (límite 20.000).
 *
 * Serialización:
 *   - Entrada: string markdown (proveniente de ece.tipo_documento.descripcion_markdown).
 *   - Salida: string markdown (vía tiptap-markdown).
 *
 * Accesibilidad:
 *   - aria-label en cada botón de toolbar.
 *   - Toolbar es <div role="toolbar">.
 *   - Editor con focus-visible.
 */
import * as React from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Markdown } from "tiptap-markdown";
import { Button } from "@his/ui/components/button";

const MAX_LENGTH = 20000;

interface ToolbarButtonProps {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}

function ToolbarButton({ onClick, active, disabled, label, children }: ToolbarButtonProps) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "outline"}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      className="h-7 px-2 text-xs"
    >
      {children}
    </Button>
  );
}

function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null;

  return (
    <div
      role="toolbar"
      aria-label="Herramientas de formato"
      className="flex flex-wrap gap-1 border-b px-2 py-1.5"
    >
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor.isActive("heading", { level: 2 })}
        label="Encabezado nivel 2"
      >
        H2
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        active={editor.isActive("heading", { level: 3 })}
        label="Encabezado nivel 3"
      >
        H3
      </ToolbarButton>
      <span className="mx-1 w-px bg-border" aria-hidden="true" />
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive("bold")}
        label="Negrita"
      >
        <strong>B</strong>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive("italic")}
        label="Itálica"
      >
        <em>I</em>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCode().run()}
        active={editor.isActive("code")}
        label="Código inline"
      >
        {"<>"}
      </ToolbarButton>
      <span className="mx-1 w-px bg-border" aria-hidden="true" />
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive("bulletList")}
        label="Lista con viñetas"
      >
        • —
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive("orderedList")}
        label="Lista numerada"
      >
        1.
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive("blockquote")}
        label="Cita"
      >
        ❝
      </ToolbarButton>
      <span className="mx-1 w-px bg-border" aria-hidden="true" />
      <ToolbarButton
        onClick={() => {
          const previousUrl = editor.getAttributes("link").href ?? "";
          const url = window.prompt("URL del enlace:", previousUrl);
          if (url === null) return;
          if (url === "") {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
            return;
          }
          editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
        }}
        active={editor.isActive("link")}
        label="Insertar enlace"
      >
        🔗
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        label="Línea horizontal"
      >
        ─
      </ToolbarButton>
    </div>
  );
}

export interface MarkdownEditorProps {
  /** Markdown inicial (puede ser null para empezar vacío). */
  value: string | null;
  /** Callback con el markdown actual cada vez que cambia. */
  onChange: (markdown: string) => void;
  /** Deshabilita edición. */
  readOnly?: boolean;
  /** Texto guía cuando está vacío. */
  placeholder?: string;
}

export function MarkdownEditor({
  value,
  onChange,
  readOnly = false,
  placeholder,
}: MarkdownEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      Markdown.configure({
        html: false,
        tightLists: true,
        breaks: false,
        linkify: true,
      }),
    ],
    content: value ?? "",
    editable: !readOnly,
    editorProps: {
      attributes: {
        class:
          "prose prose-sm dark:prose-invert max-w-none min-h-[200px] focus:outline-none px-3 py-2",
        "aria-label": "Editor de descripción markdown",
      },
    },
    onUpdate: ({ editor: e }) => {
      // tiptap-markdown expone storage.markdown.getMarkdown()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const md = (e.storage as any).markdown?.getMarkdown?.() ?? e.getText();
      onChange(md);
    },
    immediatelyRender: false,
  });

  // Sync external value changes (eg. al cargar inicial)
  React.useEffect(() => {
    if (!editor) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const current = (editor.storage as any).markdown?.getMarkdown?.() ?? editor.getText();
    if (value !== null && value !== current) {
      editor.commands.setContent(value, false);
    }
  }, [value, editor]);

  if (!editor) {
    return (
      <div className="h-48 animate-pulse rounded-md border bg-muted" aria-label="Cargando editor" />
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currentLength =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((editor.storage as any).markdown?.getMarkdown?.() ?? editor.getText() ?? "").length;
  const overLimit = currentLength > MAX_LENGTH;

  return (
    <div className="rounded-md border bg-background focus-within:ring-2 focus-within:ring-ring">
      {!readOnly && <Toolbar editor={editor} />}
      <EditorContent editor={editor} placeholder={placeholder} />
      <div className="flex items-center justify-between border-t px-3 py-1 text-xs text-muted-foreground">
        <span>
          {readOnly ? "Solo lectura" : "WYSIWYG — se guarda en formato Markdown"}
        </span>
        <span className={overLimit ? "text-destructive" : ""}>
          {currentLength.toLocaleString("es-SV")} / {MAX_LENGTH.toLocaleString("es-SV")}
        </span>
      </div>
    </div>
  );
}
