import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

type SearchParams = Promise<{ error?: string; from?: string }>;

export default async function LoginPage(props: { searchParams: SearchParams }) {
  const { error, from } = await props.searchParams;

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Lead Tracker</CardTitle>
          <CardDescription>Entre com a senha para acessar.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action="/api/auth/login" method="POST" className="flex flex-col gap-4">
            <input type="hidden" name="from" value={from ?? "/dashboard"} />
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoFocus
                required
                placeholder="********"
              />
              {error ? (
                <p className="text-sm text-red-500">Senha incorreta.</p>
              ) : null}
            </div>
            <Button type="submit" className="w-full">
              Entrar
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
