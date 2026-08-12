import { NycMap } from "./NycMap";

export default function Home() {
  return (
    <main className="app-stage">
      <section className="phone-shell" aria-label="Are You a Transplant landmark game">
        <NycMap />
      </section>
    </main>
  );
}
