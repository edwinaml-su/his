// @vitest-environment jsdom
/**
 * Tests de <PersonalSaludScreen> — S1 backlog: banner "Usuarios clínicos sin
 * perfil ECE" + alta rápida que reutiliza el form existente (ver
 * `packages/trpc/src/routers/personal-salud.router.ts` `usuariosSinPerfil` +
 * `personal-salud.router.test.ts`).
 *
 * Estrategia de mock: mismo patrón que
 * `apps/web/src/app/(admin)/catalogs/laboratorio/_components/__tests__/lab-maintenance.test.tsx`
 * (mock de `@/lib/trpc/react`, sin DB, mutations con spy estable).
 *
 * Cubre:
 *   1. `showUsuariosSinPerfil=false` no consulta ni renderiza el banner
 *      (comportamiento de `/medicos`, sin cambios).
 *   2. Banner muestra el candidato con sus roles RBAC.
 *   3. "Crear perfil" abre el dialog "Nuevo" EXISTENTE prefijado con el
 *      nombre del `User` y documento/profesión vacíos.
 *   4. Al enviar ese formulario, `create` se dispara y su `onSuccess`
 *      encadena `linkAuthUser` con el `userId` del candidato (así el alta
 *      queda con `his_user_id` poblado desde el primer momento).
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TooltipProvider } from "@his/ui/components/tooltip";
import { ToastProvider, ToastViewport } from "@his/ui/components/toast";

interface MutationOpts {
  onSuccess?: (res?: unknown) => void;
  onError?: (e: { message: string }) => void;
}

function makeMutationMock() {
  const mutate = vi.fn();
  const mutateAsync = vi.fn();
  const hook = vi.fn((_opts?: MutationOpts) => ({ mutate, mutateAsync, isPending: false }));
  return { hook, mutate, mutateAsync };
}

const mockListQuery = vi.fn();
const mockRolesQuery = vi.fn();
const mockGetQuery = vi.fn();
const mockUsuariosSinPerfilQuery = vi.fn();

const createM = makeMutationMock();
const updateM = makeMutationMock();
const setActiveM = makeMutationMock();
const linkAuthUserM = makeMutationMock();

const mockListInvalidate = vi.fn();
const mockUsuariosSinPerfilInvalidate = vi.fn();

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    personalSalud: {
      list: { useQuery: (...args: unknown[]) => mockListQuery(...args) },
      listRoles: { useQuery: (...args: unknown[]) => mockRolesQuery(...args) },
      get: { useQuery: (...args: unknown[]) => mockGetQuery(...args) },
      create: { useMutation: (opts?: MutationOpts) => createM.hook(opts) },
      update: { useMutation: (opts?: MutationOpts) => updateM.hook(opts) },
      setActive: { useMutation: (opts?: MutationOpts) => setActiveM.hook(opts) },
      usuariosSinPerfil: { useQuery: (...args: unknown[]) => mockUsuariosSinPerfilQuery(...args) },
      linkAuthUser: { useMutation: (opts?: MutationOpts) => linkAuthUserM.hook(opts) },
    },
    useUtils: () => ({
      personalSalud: {
        list: { invalidate: mockListInvalidate },
        usuariosSinPerfil: { invalidate: mockUsuariosSinPerfilInvalidate },
      },
    }),
  },
}));

import { PersonalSaludScreen } from "../personal-salud-screen";

const idleQuery = { data: undefined, isLoading: false, error: null };

const CANDIDATE = {
  userId: "00000000-0000-0000-0000-0000000000f1",
  nombre: "Enf. Ana Gómez",
  email: "ana.gomez@avante.test",
  roles: ["ENF"],
};

function renderScreen(showUsuariosSinPerfil: boolean) {
  return render(
    <ToastProvider>
      <TooltipProvider>
        <PersonalSaludScreen
          kind="no_medicos"
          title="Profesionales de la Salud"
          subtitle="Personal no-médico."
          noun="profesional"
          jvpLabel="JVP / Registro JNR"
          profesionHint="Ej. Licenciada en Enfermería"
          detailBasePath="/profesionales-salud"
          showUsuariosSinPerfil={showUsuariosSinPerfil}
        />
      </TooltipProvider>
      <ToastViewport />
    </ToastProvider>,
  );
}

describe("PersonalSaludScreen — usuarios clínicos sin perfil ECE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListQuery.mockReturnValue({ ...idleQuery, data: [] });
    mockRolesQuery.mockReturnValue({
      ...idleQuery,
      data: [{ codigo: "ENF", nombre: "Enfermería", tipo: "no_medico" }],
    });
    mockGetQuery.mockReturnValue({ ...idleQuery, data: undefined });
    mockUsuariosSinPerfilQuery.mockReturnValue({ ...idleQuery, data: [CANDIDATE] });
    for (const m of [createM, updateM, setActiveM, linkAuthUserM]) {
      m.hook.mockImplementation((_opts?: MutationOpts) => ({
        mutate: m.mutate,
        mutateAsync: m.mutateAsync,
        isPending: false,
      }));
    }
  });

  afterEach(() => cleanup());

  it("con showUsuariosSinPerfil=false no consulta (enabled:false) ni muestra el banner", () => {
    renderScreen(false);

    expect(mockUsuariosSinPerfilQuery).toHaveBeenCalledWith(
      { limit: 100 },
      expect.objectContaining({ enabled: false }),
    );
    expect(screen.queryByText(/Usuarios clínicos sin perfil ECE/)).not.toBeInTheDocument();
  });

  it("con showUsuariosSinPerfil=true muestra el banner con el candidato y sus roles", () => {
    renderScreen(true);

    expect(mockUsuariosSinPerfilQuery).toHaveBeenCalledWith(
      { limit: 100 },
      expect.objectContaining({ enabled: true }),
    );
    expect(screen.getByText("Usuarios clínicos sin perfil ECE (1)")).toBeInTheDocument();
    expect(screen.getByText(CANDIDATE.nombre)).toBeInTheDocument();
    expect(screen.getByText(CANDIDATE.email)).toBeInTheDocument();
    expect(screen.getByText("ENF")).toBeInTheDocument();
  });

  it("'Crear perfil' abre el dialog 'Nuevo' existente prefijado con el nombre; documento queda vacío", () => {
    renderScreen(true);

    fireEvent.click(screen.getByRole("button", { name: "Crear perfil" }));

    expect(screen.getByRole("heading", { name: "Nuevo profesional" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Nombre completo/)).toHaveValue(CANDIDATE.nombre);
    expect(screen.getByLabelText(/Documento de identidad/)).toHaveValue("");
  });

  it("al enviar el alta desde el banner, encadena linkAuthUser con el userId del candidato", () => {
    renderScreen(true);

    fireEvent.click(screen.getByRole("button", { name: "Crear perfil" }));
    fireEvent.change(screen.getByLabelText(/Documento de identidad/), {
      target: { value: "01234567-8" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /Enfermería/ }));
    fireEvent.click(screen.getByRole("button", { name: "Crear" }));

    expect(createM.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        documentoIdentidad: "01234567-8",
        nombreCompleto: CANDIDATE.nombre,
        rolCodigos: ["ENF"],
      }),
    );

    const onSuccess = createM.hook.mock.calls.at(-1)?.[0]?.onSuccess as
      | ((res: { id: string }) => void)
      | undefined;
    act(() => onSuccess?.({ id: "personal-1" }));

    expect(linkAuthUserM.mutate).toHaveBeenCalledWith({
      personalId: "personal-1",
      userId: CANDIDATE.userId,
    });
  });

  it("'Nuevo profesional' (sin candidato) no encadena linkAuthUser al crear", () => {
    renderScreen(true);

    fireEvent.click(screen.getByRole("button", { name: "Nuevo profesional" }));
    fireEvent.change(screen.getByLabelText(/Documento de identidad/), {
      target: { value: "01234567-8" },
    });
    fireEvent.change(screen.getByLabelText(/Nombre completo/), {
      target: { value: "Enf. Otra Persona" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /Enfermería/ }));
    fireEvent.click(screen.getByRole("button", { name: "Crear" }));

    expect(createM.mutate).toHaveBeenCalled();

    const onSuccess = createM.hook.mock.calls.at(-1)?.[0]?.onSuccess as
      | ((res: { id: string }) => void)
      | undefined;
    act(() => onSuccess?.({ id: "personal-2" }));

    expect(linkAuthUserM.mutate).not.toHaveBeenCalled();
  });
});
