"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { LngLatBoundsLike, Map as MapLibreMap } from "maplibre-gl";
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";
import { DAILY_GAMES } from "./data/dailyGames";
import { LANDMARKS } from "./data/landmarks";
import type { Difficulty, Landmark } from "./data/landmarks";
import "maplibre-gl/dist/maplibre-gl.css";

type BoundaryProperties = { id: string; name: string; borough: string };
type BoundaryFeature = Feature<Polygon | MultiPolygon, BoundaryProperties>;
type BoundaryCollection = FeatureCollection<Polygon | MultiPolygon, BoundaryProperties>;
type OverlayPaths = { neighborhood: string; width: number; height: number };

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

const NYC_BOUNDS: LngLatBoundsLike = [[-74.29, 40.48], [-73.66, 40.94]];
const NAVIGATION_BOUNDS: LngLatBoundsLike = [[-74.55, 40.25], [-73.35, 41.25]];
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

function randomFrom<T>(items: T[], count: number, random = Math.random) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled.slice(0, count);
}

function dailyFive(random = Math.random) {
  const easy = randomFrom(LANDMARKS.filter((landmark) => landmark.difficulty === "easy"), 2, random);
  const medium = randomFrom(LANDMARKS.filter((landmark) => landmark.difficulty === "medium"), 2, random);
  const hard = randomFrom(LANDMARKS.filter((landmark) => landmark.difficulty === "hard"), 1, random);
  return [...easy, ...medium, ...hard];
}

function difficultyLabel(difficulty: Difficulty) {
  return difficulty;
}

function newYorkDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function displayDate(dateKey: string, includeYear = false) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function millisecondsUntilNextNewYorkDay(now = new Date()) {
  const today = newYorkDateKey(now);
  let low = now.getTime();
  let high = low + 30 * 60 * 60 * 1000;
  while (high - low > 500) {
    const middle = Math.floor((low + high) / 2);
    if (newYorkDateKey(new Date(middle)) === today) low = middle;
    else high = middle;
  }
  return Math.max(0, high - now.getTime());
}

function countdownLabel(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function seededRandom(value: string) {
  let state = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    state ^= value.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6d2b79f5;
    let result = state;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function placesForSchedule(dateKey: string) {
  const scheduledIds = DAILY_GAMES[dateKey];
  if (!scheduledIds) return null;
  const landmarks = new Map(LANDMARKS.map((landmark) => [landmark.id, landmark]));
  const places = scheduledIds.map((id) => landmarks.get(id));
  return places.every((place): place is Landmark => Boolean(place)) ? places : null;
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
  const pressStartRef = useRef<{ x: number; y: number } | null>(null);
  const activePointersRef = useRef(new Set<number>());
  const gestureBlockedRef = useRef(false);
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
  const [gameDate] = useState(() => newYorkDateKey());
  const [nextGameIn, setNextGameIn] = useState(() => millisecondsUntilNextNewYorkDay());

  useEffect(() => {
    if (window.location.hostname !== "www.notatransplant.nyc") return;
    window.location.replace(`https://notatransplant.nyc${window.location.pathname}${window.location.search}${window.location.hash}`);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const dateKey = gameDate;
    setPlaces(placesForSchedule(dateKey) ?? dailyFive(seededRandom(dateKey)));
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
      controller.abort();
    };
  }, [gameDate]);

  useEffect(() => {
    if (phase !== "finished") return;
    const updateCountdown = () => {
      if (newYorkDateKey() !== gameDate) {
        window.location.reload();
        return;
      }
      setNextGameIn(millisecondsUntilNextNewYorkDay());
    };
    updateCountdown();
    const interval = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(interval);
  }, [gameDate, phase]);

  const clearHold = useCallback(() => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
    pressStartRef.current = null;
    navigator.vibrate?.(0);
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
    clearHold();
    navigator.vibrate?.([45, 30, 110]);
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
    const activePointers = activePointersRef.current;
    const pointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      activePointers.add(event.pointerId);

      if (activePointers.size > 1) {
        gestureBlockedRef.current = true;
        clearHold();
        return;
      }

      if (gestureBlockedRef.current) return;
      const point = { x: event.clientX, y: event.clientY };
      pressStartRef.current = point;
      setHoldPoint(point);
      navigator.vibrate?.([10, 170, 16, 145, 24, 120, 34, 95, 48, 70, 65, 48, 95]);
      holdTimerRef.current = setTimeout(() => commitGuess(point), HOLD_DURATION);
    };
    const pointerMove = (event: PointerEvent) => {
      if (gestureBlockedRef.current) return;
      const start = pressStartRef.current;
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 14) clearHold();
    };
    const pointerEnd = (event: PointerEvent) => {
      activePointers.delete(event.pointerId);
      clearHold();
      if (activePointers.size === 0) gestureBlockedRef.current = false;
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      commitGuess({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    };
    container.addEventListener("pointerdown", pointerDown);
    container.addEventListener("pointermove", pointerMove);
    container.addEventListener("pointerup", pointerEnd);
    container.addEventListener("pointercancel", pointerEnd);
    container.addEventListener("pointerleave", pointerEnd);
    container.addEventListener("keydown", keyDown);
    return () => {
      clearHold();
      activePointers.clear();
      gestureBlockedRef.current = false;
      container.removeEventListener("pointerdown", pointerDown);
      container.removeEventListener("pointermove", pointerMove);
      container.removeEventListener("pointerup", pointerEnd);
      container.removeEventListener("pointercancel", pointerEnd);
      container.removeEventListener("pointerleave", pointerEnd);
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
  const totalScore = results.reduce((sum, result) => sum + result.score, 0);
  const verdict = totalScore >= 250 ? "Not a Transplant" : "Transplant";
  const scheduleDates = Object.keys(DAILY_GAMES).sort();
  const startDate = Date.parse(`${scheduleDates[0]}T00:00:00Z`);
  const currentDate = Date.parse(`${gameDate}T00:00:00Z`);
  const gameNumber = Math.max(1, Math.floor((currentDate - startDate) / 86_400_000) + 1);
  const gameDateLabel = displayDate(gameDate);
  const shareDate = displayDate(gameDate);
  const shareScoreLine = results.map((result) => `${result.score}${scoreEmoji(result.score)}`).join(" ");
  const shareText = `www.notatransplant.nyc ${shareDate}\n${shareScoreLine}\nFinal score: ${totalScore}/500\nVerdict: ${verdict}`;

  const shareScore = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: "Are You a Transplant?", text: shareText });
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
        <div className="brand-lockup" aria-label="Are You a Transplant?">
          <span className="brand-copy"><small>ARE YOU A</small> TRANSPLANT?</span>
          <span className="daily-banner"><small>Date</small>{gameDateLabel}<i>·</i><small>No.</small>{gameNumber}</span>
        </div>
        <div className="round-pill" aria-label={`Round ${Math.min(round + 1, 5)} of 5`}>
          <span className="round-current">{Math.min(round + 1, 5)}</span>
          <span className="round-divider">/</span>
          <span className="round-total">5</span>
        </div>
      </header>

      {places[round] && phase === "guess" && (
        <section className="challenge-card" aria-live="polite">
          <span className={`difficulty-banner difficulty-${places[round].difficulty}`}>
            {difficultyLabel(places[round].difficulty)}
          </span>
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
              <div className="total-score"><strong>{totalScore}</strong><span>/ 500</span></div>
              <span className={`verdict ${totalScore >= 250 ? "verdict-local" : "verdict-transplant"}`} aria-label={verdict}>
                {totalScore >= 250 && <small>NOT A</small>}
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
            <div className="next-game-countdown" aria-live="polite">
              <span>Next game drops in</span>
              <strong>{countdownLabel(nextGameIn)}</strong>
              <small>Midnight New York time</small>
            </div>
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
            <p className="game-credits">
              Built by <a href="https://x.com/BhardwajRick" target="_blank" rel="noreferrer">Rick</a>, Inspired by <a href="https://maptap.gg/" target="_blank" rel="noreferrer">maptag.gg</a>
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
