import { ButtonLink, Card, Container } from "@/components/ui";
import { env } from "@/server/env";

// Placeholder landing page. Real copy, pricing from the plans table and the
// signup-with-store flow arrive in Stage 5.
export default function LandingPage() {
  return (
    <>
      <section className="bg-white">
        <Container className="py-20 text-center">
          <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
            Your own online store, live in minutes
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted">
            {env.PLATFORM_NAME} gives your business a branded store, an admin dashboard and payments to your own
            account. Start with a free subdomain, then connect your own domain.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <ButtonLink href="/signup">Start 30-day free trial</ButtonLink>
            <ButtonLink href="#pricing" variant="secondary">
              See pricing
            </ButtonLink>
          </div>
        </Container>
      </section>

      <section id="pricing">
        <Container className="grid gap-6 py-16 sm:grid-cols-2">
          {[
            { name: "Starter", points: ["Free subdomain", "Up to 100 products", "1 staff seat"] },
            { name: "Business", points: ["Custom domain", "Unlimited products", "5 staff seats"] },
          ].map((plan) => (
            <Card key={plan.name}>
              <h2 className="text-lg font-semibold">{plan.name}</h2>
              <p className="mt-1 text-sm text-muted">Yearly billing · prices set in super-admin (Stage 6)</p>
              <ul className="mt-4 space-y-1 text-sm">
                {plan.points.map((p) => (
                  <li key={p}>✓ {p}</li>
                ))}
              </ul>
            </Card>
          ))}
        </Container>
      </section>
    </>
  );
}
