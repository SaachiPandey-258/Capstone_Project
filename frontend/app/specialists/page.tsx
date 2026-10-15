"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowUpRight, ExternalLink, Globe, LocateFixed, MapPin, Navigation, Phone, Search } from "lucide-react";
import { RequireAuth } from "@/components/require-auth";
import { PageHeading } from "@/components/ui";
import { MapIllustration } from "@/components/illustrations";
import { api } from "@/lib/api";
import { CARE_TYPE_COLORS, specialistUnavailableMessage, validateSpecialistLocation } from "@/lib/specialists";
import { INDIA_RESOURCES } from "@/lib/site";
import type { SpecialistProvider, SpecialistSearch } from "@/lib/types";

// Leaflet needs the browser `window`, so the map loads on the client only.
const CareMap = dynamic(() => import("@/components/care-map"), {
  ssr: false,
  loading: () => <div className="care-map care-map-loading" aria-hidden="true" />,
});

const QUICK_CITIES = ["Mumbai", "Delhi", "Bengaluru", "Pune", "Hyderabad", "Chennai", "Kolkata"];

function SpecialistSearchPage() {
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState<SpecialistSearch["category"]>("parkinsons-care");
  const [radius, setRadius] = useState("25");
  const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number } | null>(null);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [providers, setProviders] = useState<SpecialistProvider[] | null>(null);
  const [attribution, setAttribution] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function reset() {
    setProviders(null);
    setMessage("");
    setAttribution("");
    setSelectedId(null);
  }

  function useLocation() {
    reset();
    setError(false);
    setCoordinates(null);
    if (!navigator.geolocation) {
      setError(true);
      setMessage("Location services are not available in this browser. Enter a city, area or PIN code instead.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setCoordinates({ latitude: coords.latitude, longitude: coords.longitude });
        setLocation("Current location");
      },
      (reason) => {
        setError(true);
        setMessage(reason.code === reason.PERMISSION_DENIED
          ? "Location permission was denied. You can enter a city, area or PIN code instead."
          : "We could not determine your location. Enter a city, area or PIN code instead.");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  async function runSearch(place: string) {
    const invalid = validateSpecialistLocation(place);
    if (invalid) {
      setError(true);
      setMessage(invalid);
      setProviders(null);
      return;
    }
    setSearching(true);
    reset();
    setError(false);
    const query: SpecialistSearch = {
      location: place.trim(),
      category,
      radius: Number(radius),
      ...(coordinates && place === "Current location" ? coordinates : {}),
    };
    try {
      const result = await api.specialists(query);
      setProviders(result.providers);
      setAttribution(result.attribution);
      setMessage(result.providers.length
        ? `${result.providers.length} listing${result.providers.length === 1 ? "" : "s"} found near ${result.location}.`
        : "No matching listings were found within this radius.");
    } catch (caught) {
      setError(true);
      setMessage(specialistUnavailableMessage(caught));
      setProviders(null);
    } finally {
      setSearching(false);
    }
  }

  return <main className="private-page content-width">
    <PageHeading eyebrow="Care directory · India" title="Find Parkinson’s-related care">
      Search hospitals, neurologists, clinics, physiotherapy and support organisations near you. Listings come from OpenStreetMap and may not be Parkinson’s-specific — always confirm services directly.
    </PageHeading>
    <section className="search-card">
      <form className="specialist-form" onSubmit={(event) => { event.preventDefault(); void runSearch(location); }}>
        <div className="location-field"><label htmlFor="location">City, area or PIN code</label><div className="input-with-icon"><MapPin size={18} aria-hidden="true" /><input id="location" autoComplete="off" value={location} onChange={(event) => { setLocation(event.target.value); setCoordinates(null); reset(); }} placeholder="e.g. Andheri, Mumbai or 411001" /></div></div>
        <button className="button button-outline geo-button" type="button" onClick={useLocation}><LocateFixed size={17} /> Use my location</button>
        <div><label htmlFor="category">Care type</label><select id="category" value={category} onChange={(event) => { setCategory(event.target.value as SpecialistSearch["category"]); reset(); }}><option value="parkinsons-care">Parkinson’s-related care & organisations</option><option value="neurology">Neurology & doctors</option><option value="movement-disorders">Movement disorders & Parkinson’s</option><option value="hospitals-clinics">Hospitals & clinics</option><option value="physical-therapy">Physiotherapy & rehabilitation</option><option value="organizations">Organisations & NGOs</option></select></div>
        <div><label htmlFor="radius">Search radius</label><select id="radius" value={radius} onChange={(event) => { setRadius(event.target.value); reset(); }}><option value="5">5 km</option><option value="10">10 km</option><option value="25">25 km</option><option value="50">50 km</option><option value="100">100 km</option><option value="250">250 km</option><option value="500">500 km</option></select></div>
        <button className="button" type="submit" disabled={searching}><Search size={17} />{searching ? "Searching…" : "Search"}</button>
      </form>
      <div className="quick-cities" aria-label="Popular cities">
        <span>Popular:</span>
        {QUICK_CITIES.map((city) => <button key={city} type="button" className="chip" onClick={() => { setLocation(city); setCoordinates(null); void runSearch(city); }} disabled={searching}>{city}</button>)}
      </div>
      {coordinates && <p className="field-hint" role="status">Current location selected. Your coordinates are sent only when you choose Search.</p>}

      {searching && <div className="results-skeleton" role="status" aria-label="Searching OpenStreetMap">
        <div className="care-map care-map-loading" />
        <div className="skeleton-list">{[0, 1, 2, 3].map((index) => <div key={index} className="skeleton-card" />)}</div>
        <span className="visually-hidden">Searching mapped care listings…</span>
      </div>}

      {message && !searching && <div className={error ? "provider-unavailable" : "provider-empty"} role={error ? "alert" : "status"}><strong>{error ? "Search unavailable" : providers?.length ? "Search complete" : "No matching listings"}</strong><p>{message}</p>{!error && !providers?.length && <p className="field-hint">Try a nearby city, a larger radius, or “Hospitals & clinics”. Coverage depends on OpenStreetMap mapping in your area.</p>}</div>}

      {providers && providers.length > 0 && <div className="results-layout">
        <CareMap providers={providers} selectedId={selectedId} onSelect={setSelectedId} />
        <div className="provider-results" aria-label="OpenStreetMap specialist listings">
          {providers.map((provider) => <article className={provider.id === selectedId ? "provider-card selected" : "provider-card"} key={provider.id} onMouseEnter={() => setSelectedId(provider.id)}>
            <div className="provider-card-heading">
              <i className="provider-dot" style={{ background: CARE_TYPE_COLORS[provider.listing_type] ?? "#5d6d86" }} aria-hidden="true" />
              <div><h2>{provider.name}</h2><p>{provider.listing_type} · {provider.address || "Address not listed"}</p></div>
              <span>{provider.distance_km} km</span>
            </div>
            <div className="provider-links">
              <button type="button" className="icon-text-button" onClick={() => setSelectedId(provider.id)}><Navigation size={14} aria-hidden="true" /> Show on map</button>
              {provider.phone && <a href={`tel:${provider.phone}`}><Phone size={14} aria-hidden="true" /> {provider.phone}</a>}
              {provider.website && <a href={provider.website} target="_blank" rel="noreferrer"><Globe size={14} aria-hidden="true" /> Website</a>}
              <a href={`https://www.google.com/maps/dir/?api=1&destination=${provider.latitude},${provider.longitude}`} target="_blank" rel="noreferrer">Directions <ArrowUpRight size={13} aria-hidden="true" /></a>
              <a href={provider.osm_url} target="_blank" rel="noreferrer">OpenStreetMap <ExternalLink size={14} aria-hidden="true" /></a>
            </div>
          </article>)}
        </div>
      </div>}
      {attribution && <p className="osm-attribution">Data: {attribution}, licensed under the <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">Open Database Licence</a>.</p>}
      {!providers && !searching && !message && <div className="search-intro"><MapIllustration /><p>Enter your city or PIN code, or tap a popular city to see hospitals, neurologists and therapy services on a map.</p></div>}
    </section>

    <section className="india-centres">
      <div className="eyebrow">National centres & organisations</div>
      <h2>Specialist Parkinson’s care in India</h2>
      <div className="centre-grid">
        {INDIA_RESOURCES.map((resource) => <a key={resource.href} className="centre-card" href={resource.href} target="_blank" rel="noreferrer">
          <strong>{resource.name}</strong><p>{resource.description}</p><span>Visit website <ArrowUpRight size={14} aria-hidden="true" /></span>
        </a>)}
      </div>
      <p className="field-hint">Looking for general information? <Link href="/resources">Browse trusted resources</Link>.</p>
    </section>
    <div className="provider-note provider-limitation">Listings come from community-maintained OpenStreetMap data and may be incomplete or out of date. A hospital, clinic or doctor listing does not confirm Parkinson’s expertise. Confirm services directly; listings are not endorsements or medical advice.</div>
  </main>;
}

export default function SpecialistsPage() {
  return <RequireAuth><SpecialistSearchPage /></RequireAuth>;
}
