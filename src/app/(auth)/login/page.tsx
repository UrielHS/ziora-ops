import { signIn } from "@/auth";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="grid min-h-screen place-items-center bg-gradient-to-br from-mint-strong via-mint to-aqua p-4">
      <div className="card w-full max-w-sm p-8 text-center">
        <p className="text-2xl font-bold text-teal">Ziora <span className="font-medium text-faint">Ops</span></p>
        <p className="mt-2 text-sm text-muted">Entra con la misma cuenta de Google que usas en Event Ops.</p>
        {error === "SinRol" ? (
          <p className="mt-4 rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger">
            Tu cuenta entra a Event Ops pero no tiene rol en Ziora Ops. Pídele a Uriel o Chris que te asigne uno en Ajustes → Equipo.
          </p>
        ) : error ? (
          <p className="mt-4 rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger">Tu cuenta no está autorizada.</p>
        ) : null}
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/dashboard" });
          }}
        >
          <button className="mt-6 w-full rounded-full bg-forest px-4 py-2.5 text-sm font-semibold text-white hover:bg-forest-hover">
            Continuar con Google
          </button>
        </form>
      </div>
    </main>
  );
}
