import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";

/**
 * Signup deshabilitado por defecto: el alta de usuarios es por invitación
 * (TDR §6.1). Mantener esta página informa al usuario y evita redirecciones rotas.
 *
 * TODO(Sprint 2): habilitar invitaciones por email controladas por ADMIN.
 */
export default function SignupPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Registro deshabilitado</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          El acceso a HIS Avante es solo por invitación. Contacta al administrador
          de tu organización para solicitar una cuenta.
        </p>
      </CardContent>
    </Card>
  );
}
