import { NycMap } from "./NycMap";

export default function Home() {
  return (
    <main className="app-stage">
      <section className="phone-shell" aria-label="NYC Atlas interactive map">
        <NycMap />
      </section>
    </main>
  );
}
