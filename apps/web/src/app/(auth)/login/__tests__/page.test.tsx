// @vitest-environment jsdom
/**
 * Tests de LoginPage (CC-0010 — Login AxisMed).
 *
 * Estrategia: mock de next/navigation, @/lib/supabase/client,
 * @/app/actions/login-policy, @/app/actions/set-establishment y
 * @/lib/trpc/react. Sin DB — verifica lógica real de autenticación (no la
 * fidelidad visual del mockup, cubierta por UAT manual + Playwright).
 *
 * Todos los tests usan `?skipIntro=1` (vía el mock de useSearchParams) para
 * evitar la animación de 12.6s y sus timers/RAF — la tarjeta queda visible
 * de inmediato, como exige CC-0010 punto 4.
 *
 * @QA — E2E (Playwright): apps/web/e2e/auth.spec.ts cubre AUTH-01..04 contra
 *   Supabase real; este archivo cubre solo la lógica de componente.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockReplace = vi.fn();
const mockRefresh = vi.fn();
let searchParamsMap = new Map<string, string>();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, refresh: mockRefresh }),
  useSearchParams: () => ({
    get: (key: string) => searchParamsMap.get(key) ?? null,
  }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: React.ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/font/google", () => ({
  Sora: () => ({ className: "sora-mock" }),
}));

const mockSignInWithPassword = vi.fn();
const mockSignInWithOAuth = vi.fn();
const mockSignOut = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
      signInWithOAuth: (...args: unknown[]) => mockSignInWithOAuth(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
    },
  }),
}));

const mockIsAccountLocked = vi.fn();
const mockRecordLoginAttempt = vi.fn();

vi.mock("@/app/actions/login-policy", () => ({
  isAccountLocked: (...args: unknown[]) => mockIsAccountLocked(...args),
  recordLoginAttempt: (...args: unknown[]) => mockRecordLoginAttempt(...args),
}));

const mockSetEstablishment = vi.fn();

vi.mock("@/app/actions/set-establishment", () => ({
  setEstablishment: (...args: unknown[]) => mockSetEstablishment(...args),
}));

const mockUseQuery = vi.fn();

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    organization: {
      listMine: { useQuery: (...args: unknown[]) => mockUseQuery(...args) },
    },
  },
}));

import LoginPage from "../page";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// Ancladas (^...$) porque el botón-ojo tiene aria-label "Ver/Ocultar
// contraseña", que también matchearía un /contraseña/i sin anclar.
const PASSWORD_LABEL = /^contraseña$/i;

async function fillAndSubmit(email = "user@avante.test", password = "Secreta123!") {
  fireEvent.change(screen.getByLabelText(/correo/i), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(PASSWORD_LABEL), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: /ingresar al sistema/i }));
}

describe("LoginPage (CC-0010)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsMap = new Map([["skipIntro", "1"]]);
    mockMatchMedia(false);
    mockIsAccountLocked.mockResolvedValue({ locked: false });
    mockRecordLoginAttempt.mockResolvedValue({});
    mockUseQuery.mockReturnValue({ data: undefined, isSuccess: false });
  });

  afterEach(() => cleanup());

  it("renderiza con la animación saltada (?skipIntro=1) y expone los campos del formulario", () => {
    render(<LoginPage />);

    expect(screen.getByLabelText(/correo/i)).toBeInTheDocument();
    expect(screen.getByLabelText(PASSWORD_LABEL)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ingresar al sistema/i })).toBeInTheDocument();
  });

  it("respeta prefers-reduced-motion aunque no venga ?skipIntro=1", () => {
    searchParamsMap = new Map();
    mockMatchMedia(true);
    render(<LoginPage />);

    // La tarjeta sigue accesible de inmediato (sin esperar los 12.6s).
    expect(screen.getByRole("button", { name: /ingresar al sistema/i })).toBeInTheDocument();
  });

  it("el submit llama a signInWithPassword con las credenciales ingresadas", async () => {
    mockSignInWithPassword.mockResolvedValue({ error: null });
    mockUseQuery.mockReturnValue({ data: [], isSuccess: true });

    render(<LoginPage />);
    await fillAndSubmit("user@avante.test", "Secreta123!");

    await waitFor(() =>
      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: "user@avante.test",
        password: "Secreta123!",
      }),
    );
  });

  it("muestra el error de Supabase con role=alert (AUTH-02)", async () => {
    mockSignInWithPassword.mockResolvedValue({ error: { message: "Credenciales inválidas" } });

    render(<LoginPage />);
    await fillAndSubmit();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/credenciales inválidas/i);
  });

  it("el toggle ES/EN cambia las etiquetas visibles", () => {
    render(<LoginPage />);

    expect(screen.getByRole("button", { name: "Ingresar al sistema" })).toBeInTheDocument();
    expect(screen.getByLabelText(/correo/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "EN" }));

    expect(screen.getByRole("button", { name: "Enter the system" })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });

  it("muestra el paso 2 (selección de sede) cuando el usuario tiene más de una", async () => {
    mockSignInWithPassword.mockResolvedValue({ error: null });
    mockUseQuery.mockReturnValue({
      data: [
        {
          id: "org1",
          legalName: "Org Uno",
          tradeName: null,
          establishments: [
            { id: "e1", name: "Sede A" },
            { id: "e2", name: "Sede B" },
          ],
        },
      ],
      isSuccess: true,
    });
    mockSetEstablishment.mockResolvedValue({ ok: true });

    render(<LoginPage />);
    await fillAndSubmit();

    const select = await screen.findByRole("combobox");
    fireEvent.change(select, { target: { value: "e2" } });
    fireEvent.click(screen.getByRole("button", { name: /ingresar a la sede/i }));

    await waitFor(() => expect(mockSetEstablishment).toHaveBeenCalledWith("e2"));
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
  });

  it("auto-avanza sin mostrar el paso 2 cuando el usuario tiene una sola sede", async () => {
    mockSignInWithPassword.mockResolvedValue({ error: null });
    mockUseQuery.mockReturnValue({
      data: [
        {
          id: "org1",
          legalName: "Org Uno",
          tradeName: null,
          establishments: [{ id: "e1", name: "Sede Única" }],
        },
      ],
      isSuccess: true,
    });
    mockSetEstablishment.mockResolvedValue({ ok: true });

    render(<LoginPage />);
    await fillAndSubmit();

    await waitFor(() => expect(mockSetEstablishment).toHaveBeenCalledWith("e1"));
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
  });
});
