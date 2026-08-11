"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { LngLatBoundsLike, Map as MapLibreMap } from "maplibre-gl";
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";

type BoundaryProperties = { id: string; name: string; borough: string };
type BoundaryFeature = Feature<Polygon | MultiPolygon, BoundaryProperties>;
type BoundaryCollection = FeatureCollection<Polygon | MultiPolygon, BoundaryProperties>;
type OverlayPaths = { neighborhood: string; width: number; height: number };

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
  distanceScore: number;
  boroughBonus: number;
  neighborhoodBonus: number;
  neighborhoodName: string;
  neighborhood: BoundaryFeature | null;
  score: number;
};

const LANDMARKS: Landmark[] = [
  { name: "Statue of Liberty", borough: "Manhattan", coordinates: [-74.0445, 40.6892], wikipedia: "https://en.wikipedia.org/wiki/Statue_of_Liberty" },
  { name: "Empire State Building", borough: "Manhattan", coordinates: [-73.9857, 40.7484], wikipedia: "https://en.wikipedia.org/wiki/Empire_State_Building" },
  { name: "Brooklyn Bridge", borough: "Brooklyn", coordinates: [-73.9947, 40.7034], wikipedia: "https://en.wikipedia.org/wiki/Brooklyn_Bridge" },
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

function scoreFor(distance: number, boroughBonus: number, neighborhoodBonus: number) {
  const distanceScore = Math.round(70 * Math.exp(-distance / 4));
  return {
    distanceScore,
    score: Math.min(100, distanceScore + boroughBonus + neighborhoodBonus),
  };
}

function pointInRing(point: [number, number], ring: Position[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygon(point: [number, number], rings: Position[][]) {
  return pointInRing(point, rings[0]) && !rings.slice(1).some((ring) => pointInRing(point, ring));
}

function containsPoint(feature: BoundaryFeature, point: [number, number]) {
  if (feature.geometry.type === "Polygon") return pointInPolygon(point, feature.geometry.coordinates);
  return feature.geometry.coordinates.some((polygon) => pointInPolygon(point, polygon));
}

function findBoundary(boundaries: BoundaryCollection, point: [number, number]) {
  return boundaries.features.find((feature) => containsPoint(feature, point)) ?? null;
}

function extendBoundsWithGeometry(bounds: maplibregl.LngLatBounds, feature: BoundaryFeature) {
  const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  polygons.forEach((polygon) => polygon.forEach((ring) => ring.forEach((coordinate) => bounds.extend(coordinate as [number, number]))));
}

function projectedPath(map: MapLibreMap, coordinates: Position[][]) {
  return coordinates.map((ring) => ring.map((coordinate, index) => {
    const point = map.project(coordinate as [number, number]);
    return `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`;
  }).join(" ") + " Z").join(" ");
}

function buildOverlayPaths(map: MapLibreMap, result: Result): OverlayPaths {
  const neighborhoodPolygons = result.neighborhood
    ? result.neighborhood.geometry.type === "Polygon"
      ? [result.neighborhood.geometry.coordinates]
      : result.neighborhood.geometry.coordinates
    : [];
  const neighborhood = neighborhoodPolygons.map((polygon) => projectedPath(map, polygon)).join(" ");
  const container = map.getContainer();
  return { neighborhood, width: container.clientWidth, height: container.clientHeight };
}

function scoreEmoji(score: number) {
  if (score >= 90) return "🗽";
  if (score >= 80) return "🍎";
  if (score >= 65) return "🥯";
  if (score >= 50) return "🍕";
  if (score >= 30) return "🐦";
  return "🐀";
}

export function NycMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buzzTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pressStartRef = useRef<{ x: number; y: number } | null>(null);
  const markerRefs = useRef<maplibregl.Marker[]>([]);
  const revealResultRef = useRef<Result | null>(null);
  const [places, setPlaces] = useState<Landmark[]>([]);
  const [round, setRound] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const [phase, setPhase] = useState<"guess" | "reveal" | "finished">("guess");
  const [ready, setReady] = useState(false);
  const [boundaries, setBoundaries] = useState<BoundaryCollection | null>(null);
  const [holdPoint, setHoldPoint] = useState<{ x: number; y: number } | null>(null);
  const [shareStatus, setShareStatus] = useState<"idle" | "shared" | "copied">("idle");
  const [overlayPaths, setOverlayPaths] = useState<OverlayPaths>({ neighborhood: "", width: 0, height: 0 });

  useEffect(() => {
    const timer = setTimeout(() => setPlaces(randomFive()), 0);
    const controller = new AbortController();
    fetch("/data/nyc-neighborhoods.json", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Neighborhood boundaries failed to load");
        return response.json() as Promise<BoundaryCollection>;
      })
      .then(setBoundaries)
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error(error);
      });
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, []);

  const clearHold = useCallback(() => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    if (buzzTimerRef.current) clearInterval(buzzTimerRef.current);
    holdTimerRef.current = null;
    buzzTimerRef.current = null;
    pressStartRef.current = null;
    setHoldPoint(null);
  }, []);

  const refreshOverlay = useCallback(() => {
    const map = mapRef.current;
    const result = revealResultRef.current;
    if (!map || !result) return;
    setOverlayPaths(buildOverlayPaths(map, result));
  }, []);

  const clearReveal = useCallback(() => {
    markerRefs.current.forEach((marker) => marker.remove());
    markerRefs.current = [];
    revealResultRef.current = null;
    setOverlayPaths({ neighborhood: "", width: 0, height: 0 });
  }, []);

  const showReveal = useCallback((result: Result) => {
    const map = mapRef.current;
    if (!map) return;
    clearReveal();
    revealResultRef.current = result;

    const guessNode = document.createElement("div");
    guessNode.className = "result-marker-shell";
    guessNode.setAttribute("aria-label", "Your guess");
    const guessDot = document.createElement("div");
    guessDot.className = "result-marker guess-marker";
    guessNode.appendChild(guessDot);
    const answerNode = document.createElement("div");
    answerNode.className = "result-marker-shell";
    answerNode.setAttribute("aria-label", "Correct location");
    const answerDot = document.createElement("div");
    answerDot.className = "result-marker answer-marker";
    answerNode.appendChild(answerDot);

    markerRefs.current = [
      new maplibregl.Marker({ element: guessNode }).setLngLat(result.guess).addTo(map),
      new maplibregl.Marker({ element: answerNode }).setLngLat(result.landmark.coordinates).addTo(map),
    ];

    const bounds = new maplibregl.LngLatBounds(result.guess, result.guess).extend(result.landmark.coordinates);
    if (result.neighborhood) extendBoundsWithGeometry(bounds, result.neighborhood);
    refreshOverlay();
    map.fitBounds(bounds, { padding: { top: 150, right: 55, bottom: 230, left: 55 }, maxZoom: 13.5, duration: 950 });
  }, [clearReveal, refreshOverlay]);

  const commitGuess = useCallback((point: { x: number; y: number }) => {
    const map = mapRef.current;
    const landmark = places[round];
    if (!map || !landmark || !boundaries || phase !== "guess") return;

    const rect = containerRef.current!.getBoundingClientRect();
    const lngLat = map.unproject([point.x - rect.left, point.y - rect.top]);
    const guess: [number, number] = [lngLat.lng, lngLat.lat];
    const kilometers = distanceKm(guess, landmark.coordinates);
    const correctBoundary = findBoundary(boundaries, landmark.coordinates);
    const guessedBoundary = findBoundary(boundaries, guess);
    const boroughBonus = correctBoundary && guessedBoundary?.properties.borough === correctBoundary.properties.borough ? 10 : 0;
    const neighborhoodBonus = correctBoundary && guessedBoundary?.properties.id === correctBoundary.properties.id ? 20 : 0;
    const scoring = scoreFor(kilometers, boroughBonus, neighborhoodBonus);
    const result: Result = {
      landmark,
      guess,
      distanceKm: kilometers,
      distanceScore: scoring.distanceScore,
      boroughBonus,
      neighborhoodBonus,
      neighborhoodName: correctBoundary?.properties.name ?? "Landmark area",
      neighborhood: correctBoundary,
      score: scoring.score,
    };
    navigator.vibrate?.([45, 30, 110]);
    clearHold();
    setResults((current) => [...current, result]);
    setPhase("reveal");
    showReveal(result);
  }, [boundaries, clearHold, phase, places, round, showReveal]);

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
    map.on("move", refreshOverlay);
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
    map.once("load", () => setReady(true));

    return () => {
      resizeObserver.disconnect();
      map.off("move", refreshOverlay);
      clearHold();
      clearReveal();
      map.remove();
      mapRef.current = null;
    };
  }, [clearHold, clearReveal, refreshOverlay]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || phase !== "guess" || !ready || !boundaries) return;
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
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      commitGuess({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    };
    container.addEventListener("pointerdown", pointerDown);
    container.addEventListener("pointermove", pointerMove);
    container.addEventListener("pointerup", clearHold);
    container.addEventListener("pointercancel", clearHold);
    container.addEventListener("pointerleave", clearHold);
    container.addEventListener("keydown", keyDown);
    return () => {
      clearHold();
      container.removeEventListener("pointerdown", pointerDown);
      container.removeEventListener("pointermove", pointerMove);
      container.removeEventListener("pointerup", clearHold);
      container.removeEventListener("pointercancel", clearHold);
      container.removeEventListener("pointerleave", clearHold);
      container.removeEventListener("keydown", keyDown);
    };
  }, [boundaries, clearHold, commitGuess, phase, ready]);

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

  const currentResult = results.at(-1);
  const totalScore = results.length ? Math.round(results.reduce((sum, result) => sum + result.score, 0) / results.length) : 0;
  const verdict = totalScore >= 50 ? "Not a Transplant" : "Transplant";
  const shareDate = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric" }).format(new Date());
  const shareScoreLine = results.map((result) => `${result.score}${scoreEmoji(result.score)}`).join(" ");
  const shareText = `Not a Transplant — ${shareDate}\n${shareScoreLine}\nFinal score: ${totalScore}/100\nVerdict: ${verdict}`;

  const shareScore = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: "Not a Transplant", text: shareText });
        setShareStatus("shared");
      } else {
        await navigator.clipboard.writeText(shareText);
        setShareStatus("copied");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      await navigator.clipboard.writeText(shareText);
      setShareStatus("copied");
    }

    window.setTimeout(() => setShareStatus("idle"), 2200);
  };

  const copyScore = async () => {
    await navigator.clipboard.writeText(shareText);
    setShareStatus("copied");
    window.setTimeout(() => setShareStatus("idle"), 2200);
  };

  return (
    <div className="map-experience">
      <div ref={containerRef} className="map-canvas" aria-label="Map of New York City" />
      {phase === "reveal" && overlayPaths.width > 0 && (
        <svg
          className="reveal-overlay"
          viewBox={`0 0 ${overlayPaths.width} ${overlayPaths.height}`}
          aria-hidden="true"
        >
          {overlayPaths.neighborhood && (
            <path className="neighborhood-overlay-fill" d={overlayPaths.neighborhood} fillRule="evenodd" />
          )}
        </svg>
      )}

      <header className="game-header">
        <div className="brand-lockup" aria-label="Not a Transplant">
          <span className="brand-mark">N</span>
          <span className="brand-copy"><small>NOT A</small> TRANSPLANT</span>
        </div>
        <div className="round-pill" aria-label={`Round ${Math.min(round + 1, 5)} of 5`}>
          <span className="round-current">{Math.min(round + 1, 5)}</span>
          <span className="round-divider">/</span>
          <span className="round-total">5</span>
        </div>
      </header>

      {places[round] && phase === "guess" && (
        <section className="challenge-card" aria-live="polite">
          <span className="eyebrow">Find this place</span>
          <h1>{places[round].name}</h1>
          <p>Press and hold your guess</p>
        </section>
      )}

      {holdPoint && (
        <div className="hold-target" style={{ left: holdPoint.x, top: holdPoint.y }} aria-hidden="true">
          <span /><i />
        </div>
      )}

      {(!ready || !boundaries) && <div className="map-status" role="status"><span className="loading-dot" />Drawing New York</div>}

      {phase === "reveal" && currentResult && (
        <section className="reveal-card" aria-live="polite">
          <div className="score-orb"><strong>{currentResult.score}</strong><span>/ 100</span></div>
          <div className="reveal-copy">
            <span>{currentResult.landmark.name}</span>
            <strong>{currentResult.distanceKm < 1 ? `${Math.round(currentResult.distanceKm * 1000)} m away` : `${currentResult.distanceKm.toFixed(1)} km away`}</strong>
            <em className="neighborhood-name">{currentResult.neighborhoodName}</em>
            <div className="bonus-row" aria-label={`Scoring bonuses for ${currentResult.neighborhoodName}`}>
              <span className={currentResult.neighborhoodBonus ? "bonus-earned" : "bonus-missed"}>+20 Neighborhood</span>
              <span className={currentResult.boroughBonus ? "bonus-earned" : "bonus-missed"}>+10 Borough</span>
            </div>
          </div>
          <button type="button" onClick={nextRound}>{round === 4 ? "See results" : "Next place"}</button>
        </section>
      )}

      {phase === "finished" && (
        <div className="results-backdrop">
          <section className="results-modal" role="dialog" aria-modal="true" aria-labelledby="results-title">
            <span className="eyebrow">Five places found</span>
            <h2 id="results-title">Your Transplant Score</h2>
            <div className="score-summary">
              <div className="total-score"><strong>{totalScore}</strong><span>/ 100</span></div>
              <span className={`verdict ${totalScore >= 50 ? "verdict-local" : "verdict-transplant"}`} aria-label={verdict}>
                {totalScore >= 50 && <small>NOT A</small>}
                <strong>TRANSPLANT</strong>
              </span>
            </div>
            <ol>
              {results.map((result) => (
                <li key={result.landmark.name}>
                  <span>{result.score}</span>
                  <a href={result.landmark.wikipedia} target="_blank" rel="noreferrer">{result.landmark.name}<i>↗</i></a>
                </li>
              ))}
            </ol>
            <div className="share-preview-wrap">
              <span>Share preview</span>
              <pre>{shareText}</pre>
            </div>
            <div className="result-actions">
              <button className="copy-score" type="button" onClick={copyScore}>
                {shareStatus === "copied" ? "Copied!" : "Copy"}
              </button>
              <button className="share-score" type="button" onClick={shareScore}>
                <span aria-hidden="true">↗</span>{shareStatus === "shared" ? "Shared!" : "Share"}
              </button>
            </div>
            <p className="share-status" aria-live="polite">
              {shareStatus === "copied" ? "Your score is ready to paste." : shareStatus === "shared" ? "Score shared." : ""}
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
