import { NycMap } from "../../NycMap";

export default async function ArchiveGame({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  return (
    <main className="app-stage">
      <section className="phone-shell" aria-label="Are You a Transplant archived landmark game">
        <NycMap requestedDate={date} />
      </section>
    </main>
  );
}
