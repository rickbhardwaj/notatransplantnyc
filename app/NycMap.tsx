"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { LngLatBoundsLike, Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type Landmark = {
  name: string;
  borough: string;
  coordinates: [number, number];
  wikipedia: string;
};

type Result = {
  landmark: Landmark;
  guess: [number, number];
  distanceKm: number;
  score: number;
};

const LANDMARKS: Landmark[] = [
  { name: "Statue of Liberty", borough: "Manhattan", coordinates: [-74.0445, 40.6892], wikipedia: "https://en.wikipedia.org/wiki/Statue_of_Liberty" },
  { name: "Empire State Building", borough: "Manhattan", coordinates: [-73.9857, 40.7484], wikipedia: "https://en.wikipedia.org/wiki/Empire_State_Building" },
  { name: "Brooklyn Bridge", borough: "Brooklyn", coordinates: [-73.9969, 40.7061], wikipedia: "https://en.wikipedia.org/wiki/Brooklyn_Bridge" },
  { name: "Grand Central Terminal", borough: "Manhattan", coordinates: [-73.9772, 40.7527], wikipedia: "https://en.wikipedia.org/wiki/Grand_Central_Terminal" },
  { name: "Apollo Theater", borough: "Manhattan", coordinates: [-73.9500, 40.8100], wikipedia: "https://en.wikipedia.org/wiki/Apollo_Theater" },
  { name: "Stonewall Inn", borough: "Manhattan", coordinates: [-74.0021, 40.7338], wikipedia: "https://en.wikipedia.org/wiki/Stonewall_Inn" },
  { name: "Federal Hall", borough: "Manhattan", coordinates: [-74.0101, 40.7074], wikipedia: "https://en.wikipedia.org/wiki/Federal_Hall" },
  { name: "Flatiron Building", borough: "Manhattan", coordinates: [-73.9897, 40.7411], wikipedia: "https://en.wikipedia.org/wiki/Flatiron_Building" },
  { name: "Coney Island Cyclone", borough: "Brooklyn", coordinates: [-73.9707, 40.5740], wikipedia: "https://en.wikipedia.org/wiki/Coney_Island_Cyclone" },
  { name: "Historic Richmond Town", borough: "Staten Island", coordinates: [-74.1358, 40.5709], wikipedia: "https://en.wikipedia.org/wiki/Historic_Richmond_Town" },
  { name: "Edgar Allan Poe Cottage", borough: "The Bronx", coordinates: [-73.8941, 40.8656], wikipedia: "https://en.wikipedia.org/wiki/Edgar_Allan_Poe_Cottage" },
  { name: "Louis Armstrong House", borough: "Queens", coordinates: [-73.8619, 40.7556], wikipedia: "https://en.wikipedia.org/wiki/Louis_Armstrong_House" },
  { name: "Unisphere", borough: "Queens", coordinates: [-73.8456, 40.7464], wikipedia: "https://en.wikipedia.org/wiki/Unisphere" },
  { name: "Weeksville Heritage Center", borough: "Brooklyn", coordinates: [-73.9308, 40.6744], wikipedia: "https://en.wikipedia.org/wiki/Weeksville_Heritage_Center" },
  { name: "Wyckoff House", borough: "Brooklyn", coordinates: [-73.9208, 40.6441], wikipedia: "https://en.wikipedia.org/wiki/Wyckoff_House" },
  { name: "Grant's Tomb", borough: "Manhattan", coordinates: [-73.9631, 40.8134], wikipedia: "https://en.wikipedia.org/wiki/Grant%27s_Tomb" },
  { name: "Morris–Jumel Mansion", borough: "Manhattan", coordinates: [-73.9384, 40.8346], wikipedia: "https://en.wikipedia.org/wiki/Morris%E2%80%93Jumel_Mansion" },
  { name: "Fraunces Tavern", borough: "Manhattan", coordinates: [-74.0113, 40.7034], wikipedia: "https://en.wikipedia.org/wiki/Fraunces_Tavern" },
  { name: "African Burial Ground", borough: "Manhattan", coordinates: [-74.0047, 40.7144], wikipedia: "https://en.wikipedia.org/wiki/African_Burial_Ground_National_Monument" },
  { name: "New York Botanical Garden", borough: "The Bronx", coordinates: [-73.8783, 40.8623], wikipedia: "https://en.wikipedia.org/wiki/New_York_Botanical_Garden" },
];

const NYC_BOUNDS: LngLatBoundsLike = [[-74.29, 40.48], [-73.66, 40.94]];
const NAVIGATION_BOUNDS: LngLatBoundsLike = [[-74.36, 40.43], [-73.58, 41.01]];
const HOLD_DURATION = 1150;

const CARTO_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
      ],
      tileSize: 512,
      attribution: "© CARTO · © OpenStreetMap contributors",
      maxzoom: 20,
    },
  },
  layers: [{ id: "carto-positron", type: "raster", source: "carto" }],
};

function randomFive() {
  return [...LANDMARKS].sort(() => Math.random() - 0.5).slice(0, 5);
}

function distanceKm(a: [number, number], b: [number, number]) {
  const toRad = (value: number) => value * Math.PI / 180;
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const dLat = lat2 - lat1;
  const dLng = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function scoreFor(distance: number) {
  return Math.max(0, Math.min(100, Math.round(100 * Math.exp(-distance / 3))));
}

function arcBetween(a: [number, number], b: [number, number]) {
  const points: [number, number][] = [];
  const lift = Math.min(0.055, Math.abs(a[0] - b[0]) * 0.09 + Math.abs(a[1] - b[1]) * 0.05);
  for (let i = 0; i <= 36; i += 1) {
    const t = i / 36;
    points.push([
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t + Math.sin(Math.PI * t) * lift,
    ]);
  }
  return points;
}

export function NycMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buzzTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pressStartRef = useRef<{ x: number; y: number } | null>(null);
  const markerRefs = useRef<maplibregl.Marker[]>([]);
  const [places, setPlaces] = useState<Landmark[]>([]);
  const [round, setRound] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const [phase, setPhase] = useState<"guess" | "reveal" | "finished">("guess");
  const [ready, setReady] = useState(false);
  const [holdPoint, setHoldPoint] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setPlaces(randomFive()), 0);
    return () => clearTimeout(timer);
  }, []);

  const clearHold = useCallback(() => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    if (buzzTimerRef.current) clearInterval(buzzTimerRef.current);
    holdTimerRef.current = null;
    buzzTimerRef.current = null;
    pressStartRef.current = null;
    setHoldPoint(null);
  }, []);

  const clearReveal = useCallback(() => {
    markerRefs.current.forEach((marker) => marker.remove());
    markerRefs.current = [];
    const map = mapRef.current;
    if (map?.getLayer("guess-arc")) map.removeLayer("guess-arc");
    if (map?.getSource("guess-arc")) map.removeSource("guess-arc");
  }, []);

  const showReveal = useCallback((result: Result) => {
    const map = mapRef.current;
    if (!map) return;
    clearReveal();

    const guessNode = document.createElement("div");
    guessNode.className = "result-marker guess-marker";
    guessNode.setAttribute("aria-label", "Your guess");
    const answerNode = document.createElement("div");
    answerNode.className = "result-marker answer-marker";
    answerNode.setAttribute("aria-label", "Correct location");

    markerRefs.current = [
      new maplibregl.Marker({ element: guessNode }).setLngLat(result.guess).addTo(map),
      new maplibregl.Marker({ element: answerNode }).setLngLat(result.landmark.coordinates).addTo(map),
    ];

    map.addSource("guess-arc", {
      type: "geojson",
      data: {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: arcBetween(result.guess, result.landmark.coordinates) },
      },
    });
    map.addLayer({
      id: "guess-arc",
      type: "line",
      source: "guess-arc",
      paint: {
        "line-color": "#e84d2a",
        "line-width": 3,
        "line-opacity": 0.82,
        "line-dasharray": [1.2, 1.4],
      },
    });

    const bounds = new maplibregl.LngLatBounds(result.guess, result.guess).extend(result.landmark.coordinates);
    map.fitBounds(bounds, { padding: { top: 150, right: 55, bottom: 230, left: 55 }, maxZoom: 13.5, duration: 950 });
  }, [clearReveal]);

  const commitGuess = useCallback((point: { x: number; y: number }) => {
    const map = mapRef.current;
    const landmark = places[round];
    if (!map || !landmark || phase !== "guess") return;

    const rect = containerRef.current!.getBoundingClientRect();
    const lngLat = map.unproject([point.x - rect.left, point.y - rect.top]);
    const guess: [number, number] = [lngLat.lng, lngLat.lat];
    const kilometers = distanceKm(guess, landmark.coordinates);
    const result: Result = {
      landmark,
      guess,
      distanceKm: kilometers,
      score: scoreFor(kilometers),
    };
    navigator.vibrate?.([45, 30, 110]);
    clearHold();
    setResults((current) => [...current, result]);
    setPhase("reveal");
    showReveal(result);
  }, [clearHold, phase, places, round, showReveal]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const container = containerRef.current;
    const map = new maplibregl.Map({
      container,
      style: CARTO_STYLE,
      bounds: NYC_BOUNDS,
      fitBoundsOptions: { padding: 30 },
      maxBounds: NAVIGATION_BOUNDS,
      minZoom: 8.7,
      maxZoom: 18,
      dragRotate: false,
      touchPitch: false,
      attributionControl: false,
    });
    mapRef.current = map;
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(container);
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
    map.once("load", () => setReady(true));

    return () => {
      resizeObserver.disconnect();
      clearHold();
      clearReveal();
      map.remove();
      mapRef.current = null;
    };
  }, [clearHold, clearReveal]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || phase !== "guess" || !ready) return;
    const pointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const point = { x: event.clientX, y: event.clientY };
      pressStartRef.current = point;
      setHoldPoint(point);
      let strength = 7;
      navigator.vibrate?.(strength);
      buzzTimerRef.current = setInterval(() => {
        strength = Math.min(32, strength + 5);
        navigator.vibrate?.(strength);
      }, 210);
      holdTimerRef.current = setTimeout(() => commitGuess(point), HOLD_DURATION);
    };
    const pointerMove = (event: PointerEvent) => {
      const start = pressStartRef.current;
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 14) clearHold();
    };
    container.addEventListener("pointerdown", pointerDown);
    container.addEventListener("pointermove", pointerMove);
    container.addEventListener("pointerup", clearHold);
    container.addEventListener("pointercancel", clearHold);
    container.addEventListener("pointerleave", clearHold);
    return () => {
      clearHold();
      container.removeEventListener("pointerdown", pointerDown);
      container.removeEventListener("pointermove", pointerMove);
      container.removeEventListener("pointerup", clearHold);
      container.removeEventListener("pointercancel", clearHold);
      container.removeEventListener("pointerleave", clearHold);
    };
  }, [clearHold, commitGuess, phase, ready]);

  const nextRound = () => {
    clearReveal();
    if (round === 4) {
      setPhase("finished");
      return;
    }
    setRound((value) => value + 1);
    setPhase("guess");
    mapRef.current?.fitBounds(NYC_BOUNDS, { padding: 30, duration: 850 });
  };

  const playAgain = () => {
    clearReveal();
    setPlaces(randomFive());
    setResults([]);
    setRound(0);
    setPhase("guess");
    mapRef.current?.fitBounds(NYC_BOUNDS, { padding: 30, duration: 700 });
  };

  const currentResult = results.at(-1);
  const totalScore = results.reduce((sum, result) => sum + result.score, 0);

  return (
    <div className="map-experience">
      <div ref={containerRef} className="map-canvas" aria-label="Map of New York City" />

      <header className="game-header">
        <div className="brand-lockup" aria-label="NYC Atlas"><span className="brand-mark">N</span><span>NYC ATLAS</span></div>
        <div className="round-pill">{Math.min(round + 1, 5)} <span>/ 5</span></div>
      </header>

      {places[round] && phase === "guess" && (
        <section className="challenge-card" aria-live="polite">
          <span className="eyebrow">Find this place</span>
          <h1>{places[round].name}</h1>
          <p>{places[round].borough} · Press and hold your guess</p>
        </section>
      )}

      {holdPoint && (
        <div className="hold-target" style={{ left: holdPoint.x, top: holdPoint.y }} aria-hidden="true">
          <span /><i />
        </div>
      )}

      {!ready && <div className="map-status" role="status"><span className="loading-dot" />Drawing New York</div>}

      {phase === "reveal" && currentResult && (
        <section className="reveal-card" aria-live="polite">
          <div className="score-orb"><strong>{currentResult.score}</strong><span>/ 100</span></div>
          <div className="reveal-copy">
            <span>{currentResult.landmark.name}</span>
            <strong>{currentResult.distanceKm < 1 ? `${Math.round(currentResult.distanceKm * 1000)} m away` : `${currentResult.distanceKm.toFixed(1)} km away`}</strong>
          </div>
          <button type="button" onClick={nextRound}>{round === 4 ? "See results" : "Next place"}</button>
        </section>
      )}

      {phase === "finished" && (
        <div className="results-backdrop">
          <section className="results-modal" role="dialog" aria-modal="true" aria-labelledby="results-title">
            <span className="eyebrow">Five places found</span>
            <h2 id="results-title">Your NYC score</h2>
            <div className="total-score"><strong>{totalScore}</strong><span>/ 500</span></div>
            <ol>
              {results.map((result) => (
                <li key={result.landmark.name}>
                  <span>{result.score}</span>
                  <a href={result.landmark.wikipedia} target="_blank" rel="noreferrer">{result.landmark.name}<i>↗</i></a>
                </li>
              ))}
            </ol>
            <button className="play-again" type="button" onClick={playAgain}>Play again</button>
          </section>
        </div>
      )}
    </div>
  );
}
