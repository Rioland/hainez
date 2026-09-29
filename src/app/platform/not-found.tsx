import { ButtonLink, Container } from "@/components/ui";

export default function PlatformNotFound() {
  return (
    <Container className="flex flex-1 flex-col items-center justify-center py-24 text-center">
      <h1 className="text-3xl font-semibold">Page not found</h1>
      <ButtonLink href="/" variant="secondary" className="mt-6">
        Go home
      </ButtonLink>
    </Container>
  );
}
